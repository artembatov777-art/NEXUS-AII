import { describe, expect, it } from "vitest";
import { AgentCheckpointService, type AgentCheckpoint } from "./agentCheckpoints";
import { LocalStorageAgentCheckpointRepository } from "../lib/agentCheckpointStorage";
import type { StorageLike } from "../lib/memoryStorage";

class FakeStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const checkpoint = (overrides: Partial<AgentCheckpoint> = {}): AgentCheckpoint => ({
  schemaVersion: 1, runId: "run-1", agentId: "research", threadId: "thread-1",
  sequence: 1, status: "running", state: { cursor: 0, notes: ["started"] },
  createdAt: 100, updatedAt: 100, ...overrides
});

describe("AgentCheckpointService", () => {
  it("persists and retrieves versioned snapshots", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    expect((await service.persist(checkpoint())).ok).toBe(true);
    expect((await service.persist(checkpoint({ sequence: 2, updatedAt: 200, state: { cursor: 1 } }))).ok).toBe(true);
    const loaded = await service.get("run-1");
    expect(loaded.ok && loaded.value?.sequence).toBe(2);
    expect(loaded.ok && loaded.value?.state).toEqual({ cursor: 1 });
  });

  it("rejects skipped sequence numbers and changed run identity", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    await service.persist(checkpoint());
    expect((await service.persist(checkpoint({ sequence: 3, updatedAt: 200 }))).ok).toBe(false);
    expect((await service.persist(checkpoint({ sequence: 2, agentId: "other", updatedAt: 200 }))).ok).toBe(false);
  });

  it("does not allow writes after a terminal state", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    await service.persist(checkpoint({ status: "completed" }));
    expect((await service.persist(checkpoint({ sequence: 2, updatedAt: 200 }))).ok).toBe(false);
  });

  it("validates approval state and bounded JSON payloads", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    expect((await service.persist(checkpoint({ pendingApproval: { permission: "filesystem:write", requestedAt: 100 } }))).ok).toBe(false);
    expect((await service.persist(checkpoint({ state: "x".repeat(300_000) }))).ok).toBe(false);
  });

  it("lists newest snapshots for a thread", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    await service.persist(checkpoint());
    await service.persist(checkpoint({ runId: "run-2", sequence: 1, updatedAt: 150 }));
    const list = await service.listByThread("thread-1", 10);
    expect(list.ok && list.value.map(item => item.runId)).toEqual(["run-2", "run-1"]);
  });

  it("uses compare-and-swap to reject stale repository writes", async () => {
    const repository = new LocalStorageAgentCheckpointRepository(new FakeStorage());
    expect((await repository.save(checkpoint(), null)).ok).toBe(true);
    expect((await repository.save(checkpoint({ sequence: 2, updatedAt: 200 }), null)).ok).toBe(false);
  });
});
  it("rejects non-JSON values, non-finite numbers, and prototype-sensitive keys", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    expect((await service.persist(checkpoint({ state: { value: Number.NaN } }))).ok).toBe(false);
    expect((await service.persist(checkpoint({ state: { value: undefined } as unknown as AgentCheckpoint["state"] }))).ok).toBe(false);
    expect((await service.persist(checkpoint({ state: JSON.parse('{"__proto__":{"polluted":true}}') }))).ok).toBe(false);
  });

  it("rejects corrupted persisted checkpoint records", async () => {
    const storage = new FakeStorage();
    storage.values.set("nexus-au:agent-checkpoints:v1", JSON.stringify([{ ...checkpoint(), status: "mystery" }]));
    const repository = new LocalStorageAgentCheckpointRepository(storage);
    expect((await repository.get("run-1")).ok).toBe(false);
  });

