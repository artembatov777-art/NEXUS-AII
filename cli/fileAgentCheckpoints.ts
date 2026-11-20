import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import {
  validateAgentCheckpoint, type AgentCheckpoint, type AgentCheckpointRepository
} from "../src/core/agentCheckpoints";
import { err, ok, type Result } from "../src/core/result";

const MAX_CHECKPOINT_BYTES = 320 * 1024;
const MAX_LISTED_FILES = 5_000;
const MAX_LIST_LIMIT = 200;
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(id);

function noFollow(): number {
  return process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
}

function privateOwned(info: {
  isFile(): boolean; nlink: bigint; mode: bigint; uid: bigint
}): boolean {
  if (!info.isFile() || info.nlink !== 1n) return false;
  if (process.platform === "win32") return true; // Windows ACLs require separate native review.
  const uid = process.getuid?.();
  return (info.mode & 0o077n) === 0n && (uid === undefined || info.uid === BigInt(uid));
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory()) throw new Error("Checkpoint directory is not a real directory.");
  if (process.platform !== "win32") {
    const uid = process.getuid?.();
    if ((info.mode & 0o077n) !== 0n ||
        (uid !== undefined && info.uid !== BigInt(uid))) {
      throw new Error("Checkpoint directory is not owner-private.");
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY | noFollow());
  try { await handle.sync(); }
  finally { await handle.close(); }
}

/**
 * Native CLI adapter for the same versioned CAS checkpoint contract used in
 * Desktop. Checkpoints are owner-private plaintext; the contract is shared,
 * not the underlying Desktop SQLite/localStorage database.
 *
 * A per-run exclusive lock coordinates cooperating CLI processes. An orphan
 * lock is NEVER stolen; it requires inspection because a previous worker may
 * have crossed an external side-effect boundary. No automatic deletion/retry.
 */
export class FileAgentCheckpointRepository implements AgentCheckpointRepository {
  constructor(private readonly directory: string) {}

  private path(runId: string) { return join(this.directory, runId + ".json"); }

  private async prepareForReading(): Promise<boolean> {
    try {
      await assertPrivateDirectory(this.directory);
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw cause;
    }
  }

  private async readRun(runId: string): Promise<AgentCheckpoint | null> {
    if (!await this.prepareForReading()) return null;
    const path = this.path(runId);
    let prior: Awaited<ReturnType<typeof lstat>>;
    try { prior = await lstat(path, { bigint: true }); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
    if (!privateOwned(prior)) throw new Error("Unsafe checkpoint file.");
    const handle = await open(path, constants.O_RDONLY | noFollow());
    let raw: Buffer;
    try {
      const before = await handle.stat({ bigint: true });
      if (!privateOwned(before) || before.dev !== prior.dev ||
          before.ino !== prior.ino ||
          before.size > BigInt(MAX_CHECKPOINT_BYTES)) {
        throw new Error("Checkpoint identity changed or file is oversized.");
      }
      raw = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (raw.byteLength > MAX_CHECKPOINT_BYTES ||
          after.dev !== before.dev || after.ino !== before.ino ||
          after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
          !privateOwned(after)) {
        throw new Error("Checkpoint changed while being read.");
      }
    } finally { await handle.close(); }
    const final = await lstat(path, { bigint: true });
    if (!privateOwned(final) || final.dev !== prior.dev || final.ino !== prior.ino ||
        final.size !== BigInt(raw.byteLength)) {
      throw new Error("Checkpoint changed during inspection.");
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const value: unknown = JSON.parse(decoded);
    if (validateAgentCheckpoint(value as AgentCheckpoint) !== null ||
        (value as AgentCheckpoint).runId !== runId) {
      throw new Error("Checkpoint content is corrupted or mismatched.");
    }
    return value as AgentCheckpoint;
  }

  async get(runId: string): Promise<Result<AgentCheckpoint | null>> {
    if (!validId(runId)) return err("validation", "Checkpoint run ID is invalid.");
    try { return ok(await this.readRun(runId)); }
    catch { return err("storage_failed", "Checkpoint is missing, corrupted or unsafe to read."); }
  }

  async save(checkpoint: AgentCheckpoint, expectedPreviousSequence: number | null): Promise<Result<void>> {
    if (!validId(checkpoint?.runId) || validateAgentCheckpoint(checkpoint) !== null ||
        (expectedPreviousSequence !== null && (!Number.isSafeInteger(expectedPreviousSequence) ||
          expectedPreviousSequence < 1))) {
      return err("validation", "Checkpoint or expected sequence is invalid.");
    }

    let lock: Awaited<ReturnType<typeof open>> | undefined;
    const lockPath = this.path(checkpoint.runId) + ".lock";
    let tempPath: string | undefined;
    try {
      await mkdir(dirname(this.directory), { recursive: true, mode: 0o700 });
      await assertPrivateDirectory(dirname(this.directory));
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await assertPrivateDirectory(this.directory);

      // O_EXCL is an inter-process claim. Never remove a lock we did not create.
      lock = await open(lockPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow(), 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }) + "\n");
      await lock.sync();
      const current = await this.readRun(checkpoint.runId);
      if ((current?.sequence ?? null) !== expectedPreviousSequence) {
        return err("storage_failed", "Checkpoint changed concurrently; reload before retrying.");
      }
      if (checkpoint.sequence !== (current?.sequence ?? 0) + 1 ||
          (current && (current.agentId !== checkpoint.agentId ||
            current.threadId !== checkpoint.threadId ||
            current.createdAt !== checkpoint.createdAt ||
            current.updatedAt > checkpoint.updatedAt ||
            ["completed", "failed", "cancelled"].includes(current.status)))) {
        return err("validation", "Checkpoint transition is invalid.");
      }

      const serialized = JSON.stringify(checkpoint);
      if (Buffer.byteLength(serialized, "utf8") > MAX_CHECKPOINT_BYTES) {
        return err("validation", "Checkpoint exceeds the storage limit.");
      }
      tempPath = join(this.directory, "." + checkpoint.runId + "." + randomUUID() + ".tmp");
      const file = await open(tempPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow(), 0o600);
      try { await file.writeFile(serialized, "utf8"); await file.sync(); }
      finally { await file.close(); }
      await rename(tempPath, this.path(checkpoint.runId));
      tempPath = undefined;
      await syncDirectory(this.directory);
      return ok(undefined);
    } catch {
      return err("storage_failed", "Could not safely persist checkpoint; inspect its state before retrying.");
    } finally {
      if (tempPath) await unlink(tempPath).catch(() => {});
      if (lock) {
        await lock.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
      }
    }
  }

  async listByThread(threadId: string, limit: number): Promise<Result<AgentCheckpoint[]>> {
    if (!validId(threadId) || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      return err("validation", "Checkpoint thread or limit is invalid.");
    }
    try {
      if (!await this.prepareForReading()) return ok([]);
      const directory = await opendir(this.directory);
      const records: AgentCheckpoint[] = [];
      let scanned = 0;
      for await (const entry of directory) {
        if (++scanned > MAX_LISTED_FILES) throw new Error("Too many checkpoints to inspect safely.");
        if (!entry.name.endsWith(".json")) continue;
        const runId = entry.name.slice(0, -5);
        if (!validId(runId)) throw new Error("Invalid checkpoint filename.");
        const record = await this.readRun(runId);
        if (!record) throw new Error("Checkpoint vanished during scan.");
        if (record.threadId === threadId) records.push(record);
      }
      records.sort((a, b) => b.updatedAt - a.updatedAt || a.runId.localeCompare(b.runId));
      return ok(records.slice(0, limit));
    } catch { return err("storage_failed", "Could not safely inspect agent checkpoints."); }
  }

  async delete(_runId: string): Promise<Result<void>> {
    // Deletion is intentionally disabled until a separate explicit
    // owner-approved retention and recovery workflow is implemented.
    return err("permission_denied", "CLI agent checkpoints require an explicit retention and deletion workflow.");
  }
}
