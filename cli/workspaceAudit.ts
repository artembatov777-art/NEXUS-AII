import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "../src/core/result";
import { MAX_TOOL_AUDIT_HISTORY_EVENTS, type ToolAuditEvent, type ToolAuditSink } from "../src/core/tools";

const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_BYTES = 8_192;

function validRunId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value);
}

function validEvent(value: unknown): value is ToolAuditEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<ToolAuditEvent>;
  return validRunId(event.runId) &&
    typeof event.toolId === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(event.toolId) &&
    validText(event.traceId, 160) &&
    ["started", "completed", "failed", "denied", "reconciled"].includes(String(event.status)) &&
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp) &&
    (event.detail === undefined || validText(event.detail, 1_000));
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const info = await lstat(path, { bigint: true });
  const owner = process.getuid?.();
  if (!info.isDirectory() ||
      (process.platform !== "win32" && ((info.mode & 0o077n) !== 0n ||
        (owner !== undefined && info.uid !== BigInt(owner))))) {
    throw new Error("Workspace audit directory is not private.");
  }
}

function fileModeIsPrivate(mode: bigint, ownerId: bigint): boolean {
  const owner = process.getuid?.();
  return process.platform === "win32" ||
    ((mode & 0o077n) === 0n && (owner === undefined || ownerId === BigInt(owner)));
}

function unixFlags(): number {
  return process.platform === "win32" ? 0 :
    (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
}

async function readVerifiedJournal(path: string): Promise<string | null> {
  let initial: Awaited<ReturnType<typeof lstat>>;
  try { initial = await lstat(path, { bigint: true }); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
  if (!initial.isFile() || initial.nlink !== 1n ||
      !fileModeIsPrivate(initial.mode, initial.uid)) throw new Error("Invalid workspace audit journal.");
  if (initial.size > BigInt(MAX_JOURNAL_BYTES)) throw new Error("Workspace audit journal exceeds the limit.");

  const handle = await open(path, constants.O_RDONLY | unixFlags());
  try {
    const current = await handle.stat({ bigint: true });
    if (!current.isFile() || current.nlink !== 1n ||
        current.dev !== initial.dev || current.ino !== initial.ino ||
        !fileModeIsPrivate(current.mode, current.uid)) throw new Error("Workspace audit journal changed during open.");
    if (current.size > BigInt(MAX_JOURNAL_BYTES)) throw new Error("Workspace audit journal exceeds the limit.");

    const bytes = Buffer.alloc(MAX_JOURNAL_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > MAX_JOURNAL_BYTES) throw new Error("Workspace audit journal exceeds the limit.");
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)); }
    catch { throw new Error("Workspace audit journal is not UTF-8."); }
  } finally { await handle.close(); }
}

/**
 * Append-only CLI tool audit, scoped to a private run directory.
 * A damaged journal causes ToolGateway to refuse replay, not to treat the run
 * as having no prior tools. Windows ACL review is still an owner-side gate.
 */
export class FileWorkspaceAuditSink implements ToolAuditSink {
  constructor(private readonly directory: string) {}

  private path(runId: string): string {
    if (!validRunId(runId)) throw new Error("Invalid workspace audit run identifier.");
    return join(this.directory, `${runId}.jsonl`);
  }

  async record(event: ToolAuditEvent): Promise<Result<void>> {
    if (!validEvent(event)) return err("validation", "Invalid workspace audit event.");
    const line = Buffer.from(JSON.stringify(event) + "\n", "utf8");
    if (line.byteLength > MAX_EVENT_BYTES) return err("validation", "Workspace audit event exceeds its limit.");
    try {
      await mkdir(dirname(this.directory), { recursive: true, mode: 0o700 });
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await assertPrivateDirectory(dirname(this.directory));
      await assertPrivateDirectory(this.directory);
      const path = this.path(event.runId);
      let file;
      let created = false;
      try {
        file = await open(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT |
          constants.O_EXCL | unixFlags(), 0o600);
        created = true;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
        const entry = await lstat(path, { bigint: true });
        if (!entry.isFile() || entry.nlink !== 1n ||
            !fileModeIsPrivate(entry.mode, entry.uid)) throw new Error("Unsafe workspace audit journal.");
        file = await open(path, constants.O_RDWR | constants.O_APPEND | unixFlags());
        const opened = await file.stat({ bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n ||
            opened.dev !== entry.dev || opened.ino !== entry.ino ||
            !fileModeIsPrivate(opened.mode, opened.uid)) {
          await file.close();
          throw new Error("Workspace audit journal changed during open.");
        }
      }
      try {
        const opened = await file.stat({ bigint: true });
        if (!opened.isFile() || opened.nlink !== 1n ||
            !fileModeIsPrivate(opened.mode, opened.uid) ||
            opened.size + BigInt(line.length) > BigInt(MAX_JOURNAL_BYTES)) {
          throw new Error("Unsafe or oversized workspace audit journal.");
        }
        if (opened.size > 0n) {
          const last = Buffer.alloc(1);
          const { bytesRead } = await file.read(last, 0, 1, Number(opened.size - 1n));
          if (bytesRead !== 1 || last[0] !== 10) {
            throw new Error("Incomplete workspace audit journal.");
          }
        }
        const { bytesWritten } = await file.write(line);
        if (bytesWritten !== line.length) throw new Error("Incomplete workspace audit write.");
        await file.sync();
      } finally { await file.close(); }
      if (created && process.platform !== "win32") {
        const directory = await open(this.directory, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      }
      return ok(undefined);
    } catch {
      return err("storage_failed", "Could not safely persist the workspace audit event.", true);
    }
  }

  async list(options: { runId?: string; limit?: number } = {}): Promise<Result<ToolAuditEvent[]>> {
    const { runId, limit = 100 } = options;
    if (!validRunId(runId) || !Number.isInteger(limit) ||
        limit < 1 || limit > MAX_TOOL_AUDIT_HISTORY_EVENTS) {
      return err("validation", "Workspace audit run ID or limit is invalid.");
    }
    try {
      const journal = await readVerifiedJournal(this.path(runId));
      if (journal === null) return ok([]);
      await assertPrivateDirectory(dirname(this.directory));
      await assertPrivateDirectory(this.directory);
      if (!journal || !journal.endsWith("\n")) throw new Error("Incomplete workspace audit journal.");
      const lines = journal.slice(0, -1).split("\n");
      if (lines.length > MAX_TOOL_AUDIT_HISTORY_EVENTS) throw new Error("Workspace audit contains too many events.");
      const events: ToolAuditEvent[] = [];
      for (const line of lines) {
        let value: unknown;
        try { value = JSON.parse(line); }
        catch { throw new Error("Invalid workspace audit JSON."); }
        if (!validEvent(value) || value.runId !== runId) throw new Error("Invalid workspace audit event record.");
        events.push(value);
      }
      return ok(events.slice(-limit));
    } catch {
      return err("storage_failed", "Workspace audit journal is unreadable or unsafe.", true);
    }
  }
}
