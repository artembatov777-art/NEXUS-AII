import { describe, expect, it } from "vitest";
import { AgentRunManager } from "./agentRunManager";
import type { AgentCheckpoint } from "../core/agentCheckpoints";

describe("checkpoint recovery ordering", () => {
  it("restores the newest valid snapshot when a run has multiple checkpoint versions", () => {
    const manager = new AgentRunManager();
    const base: AgentCheckpoint = {
      schemaVersion: 1, runId: "run-1", agentId: "agent-1",
      threadId: "nexus-agent-control-center", sequence: 1, status: "running",
      state: {}, createdAt: 100, updatedAt: 100
    };
    manager.restoreCheckpoints("standalone", [
      base,
      { ...base, sequence: 2, status: "completed", updatedAt: 200 }
    ]);
    expect(manager.list("standalone")).toMatchObject([
      { id: "run-1", status: "completed", finishedAt: 200 }
    ]);
  });
  it("ignores malformed and unrelated checkpoints without masking a valid snapshot", () => {
    const manager = new AgentRunManager();
    const base: AgentCheckpoint = {
      schemaVersion: 1, runId: "run-safe", agentId: "agent-1",
      threadId: "nexus-agent-control-center", sequence: 1,
      status: "running", state: {}, createdAt: 100, updatedAt: 100
    };
    manager.restoreCheckpoints("standalone", [
      { ...base, sequence: 99, updatedAt: 999, state: { value: Number.NaN } },
      { ...base, threadId: "other-thread", sequence: 100, updatedAt: 1000 },
      { ...base, sequence: 2, updatedAt: 200, status: "waiting_for_approval",
        pendingApproval: { permission: "workspace:write", requestedAt: 150 } },
      base
    ]);
    expect(manager.list("standalone")).toMatchObject([
      { id: "run-safe", status: "waiting_for_approval" }
    ]);
  });

  it("restores 250 independent runs without executing tasks", () => {
    const manager = new AgentRunManager();
    const checkpoints: AgentCheckpoint[] = Array.from({ length: 250 }, (_, index) => ({
      schemaVersion: 1, runId: "run-" + index, agentId: "agent-1",
      threadId: "nexus-agent-control-center", sequence: 1,
      status: "running", state: {}, createdAt: index, updatedAt: index
    }));
    manager.restoreCheckpoints("standalone", checkpoints);
    expect(manager.list("standalone")).toHaveLength(250);
    expect(manager.list("standalone").every(run => run.status === "interrupted")).toBe(true);
    expect(manager.activeRun("standalone")).toBeNull();
  });

  it("prefers sequence over timestamps and is independent of input order", () => {
    const older: AgentCheckpoint = {
      schemaVersion: 1, runId: "ordered", agentId: "agent-1",
      threadId: "nexus-agent-control-center", sequence: 2,
      status: "running", state: {}, createdAt: 10, updatedAt: 1000
    };
    const newer: AgentCheckpoint = {
      ...older, sequence: 3, updatedAt: 1001, status: "failed"
    };
    for (const snapshots of [[older, newer], [newer, older]]) {
      const manager = new AgentRunManager();
      manager.restoreCheckpoints("standalone", snapshots);
      expect(manager.list("standalone")).toMatchObject([
        { id: "ordered", status: "failed", finishedAt: 1001 }
      ]);
    }
  });

  it("prevents two managed runs from claiming the same runtime checkpoint", async () => {
    const manager = new AgentRunManager();
    await manager.start("manager-a", "chat", async () => {});
    await manager.start("manager-b", "chat", async () => {});
    manager.linkRuntimeRun("manager-a", "runtime-shared");
    expect(() => manager.linkRuntimeRun("manager-b", "runtime-shared"))
      .toThrow("already linked");
  });

  it("never replaces an existing managed run when restoring its checkpoint", async () => {
    const manager = new AgentRunManager();
    await manager.start("run-existing", "standalone", async () => {});
    const checkpoint: AgentCheckpoint = {
      schemaVersion: 1, runId: "run-existing", agentId: "agent-1",
      threadId: "nexus-agent-control-center", sequence: 1,
      status: "running", state: {}, createdAt: 100, updatedAt: 100
    };
    manager.restoreCheckpoints("standalone", [checkpoint]);
    expect(manager.list("standalone")).toHaveLength(1);
    expect(manager.list("standalone")[0].status).toBe("completed");
  });

});
