import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, chmod, link, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileAgentCheckpointRepository } from "./fileAgentCheckpoints";
import { AgentCheckpointService, type AgentCheckpoint } from "../src/core/agentCheckpoints";

const fixture = (patch: Partial<AgentCheckpoint> = {}): AgentCheckpoint => ({
  schemaVersion: 1,
  runId: "run-1",
  agentId: "nexus.plan",
  threadId: "workspace-main",
  sequence: 1,
  status: "running",
  state: { phase: "planned", completed: 0 },
  createdAt: 100,
  updatedAt: 100,
  ...patch
});

async function isolated(test: (directory: string) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), "nexus-checkpoints-"));
  const directory = join(parent, "agent-checkpoints");
  try { await test(directory); }
  finally { await rm(parent, { recursive: true, force: true }); }
}

describe("private CLI checkpoint repository", () => {
  it("durably stores versioned snapshots for the shared AgentCheckpointService", async () => {
    await isolated(async directory => {
      const storage = new FileAgentCheckpointRepository(directory);
      const service = new AgentCheckpointService(storage);
      expect(await service.get("run-1")).toEqual({ ok: true, value: null });
      expect(await service.persist(fixture())).toEqual({ ok: true, value: undefined });
      expect(await storage.get("run-1")).toEqual({ ok: true, value: fixture() });
      expect(await service.persist(fixture({ sequence: 2, updatedAt: 200, state: { phase: "completed", completed: 1 }, status: "completed" })))
        .toEqual({ ok: true, value: undefined });
      const fresh = new FileAgentCheckpointRepository(directory);
      const reloaded = await fresh.get("run-1");
      expect(reloaded.ok && reloaded.value?.sequence).toBe(2);
      expect(reloaded.ok && reloaded.value?.status).toBe("completed");
      expect((await readFile(join(directory, "run-1.json"), "utf8")).trim()).toContain('"sequence":2');
      await expect(access(join(directory, "run-1.json.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("allows only one of two concurrent compare-and-swap checkpoint writers to succeed", async () => {
    await isolated(async directory => {
      const a = new FileAgentCheckpointRepository(directory);
      const b = new FileAgentCheckpointRepository(directory);
      expect((await a.save(fixture(), null)).ok).toBe(true);
      const first = fixture({ sequence: 2, updatedAt: 200, state: { writer: "A" } });
      const second = fixture({ sequence: 2, updatedAt: 201, state: { writer: "B" } });
      const outcomes = await Promise.all([
        a.save(first, 1), b.save(second, 1)
      ]);
      expect(outcomes.filter(item => item.ok)).toHaveLength(1);
      expect(outcomes.filter(item => !item.ok)).toHaveLength(1);
      const result = await b.get("run-1");
      expect(result.ok && result.value?.sequence).toBe(2);
      expect(result.ok && result.value?.state)
        .toEqual(outcomes[0].ok ? { writer: "A" } : { writer: "B" });
      await expect(access(join(directory, "run-1.json.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("rejects stale or wrong initial sequence and preserves the saved checkpoint", async () => {
    await isolated(async directory => {
      const storage = new FileAgentCheckpointRepository(directory);
      expect((await storage.save(fixture(), null)).ok).toBe(true);
      expect((await storage.save(fixture({ sequence: 2 }), null)).ok).toBe(false);
      expect((await storage.save(fixture({ sequence: 3 }), 1)).ok).toBe(false);
      expect((await storage.save(fixture({ runId: "../secret" }), null)).ok).toBe(false);
      expect((await storage.get("../secret")).ok).toBe(false);
      expect((await storage.listByThread("workspace-main", 0)).ok).toBe(false);
      expect(await storage.get("run-1")).toEqual({ ok: true, value: fixture() });
    });
  });

  it("lists only the requested thread, without deleting checkpoints", async () => {
    await isolated(async directory => {
      const storage = new FileAgentCheckpointRepository(directory);
      for (const item of [
        fixture({ runId: "run-1", updatedAt: 100 }),
        fixture({ runId: "run-2", updatedAt: 200 }),
        fixture({ runId: "run-3", threadId: "unrelated", updatedAt: 300 })
      ]) expect((await storage.save(item, null)).ok).toBe(true);
      const result = await storage.listByThread("workspace-main", 2);
      expect(result.ok && result.value.map(item => item.runId)).toEqual(["run-2", "run-1"]);
      expect((await storage.delete("run-1")).ok).toBe(false);
      expect((await storage.get("run-1")).ok).toBe(true);
    });
  });

  it("fails closed on damaged persisted state rather than overwriting it", async () => {
    await isolated(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, "run-1.json");
      await writeFile(file, "{broken json", { mode: 0o600 });
      const storage = new FileAgentCheckpointRepository(directory);
      expect((await storage.get("run-1")).ok).toBe(false);
      expect((await storage.save(fixture(), null)).ok).toBe(false);
      expect(await readFile(file, "utf8")).toBe("{broken json");
    });
  });

  it("does not steal an abandoned writer lock or overwrite the run", async () => {
    await isolated(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const lockPath = join(directory, "run-1.json.lock");
      await writeFile(lockPath, "unconfirmed previous writer", { flag: "wx", mode: 0o600 });
      const storage = new FileAgentCheckpointRepository(directory);
      expect((await storage.save(fixture(), null)).ok).toBe(false);
      expect(await readFile(lockPath, "utf8")).toBe("unconfirmed previous writer");
      expect(await storage.get("run-1")).toEqual({ ok: true, value: null });
    });
  });

  it("rejects symlinks, hardlinks, and public directories on Unix", async () => {
    if (process.platform === "win32") return;
    await isolated(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const outside = join(directory, "outside");
      await writeFile(outside, JSON.stringify(fixture()), { mode: 0o600 });
      const path = join(directory, "run-1.json");
      await symlink(outside, path);
      const storage = new FileAgentCheckpointRepository(directory);
      expect((await storage.get("run-1")).ok).toBe(false);
      expect((await storage.save(fixture(), null)).ok).toBe(false);
      await rm(path);
      await link(outside, path);
      expect((await storage.get("run-1")).ok).toBe(false);
      await rm(path);
      await chmod(directory, 0o755);
      expect((await storage.get("run-1")).ok).toBe(false);
      expect((await storage.save(fixture(), null)).ok).toBe(false);
    });
  });
});
