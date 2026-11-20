import { describe, expect, it } from "vitest";
import { ToolReconciliationService } from "./toolReconciliation";
import { ok } from "./result";
import type { AgentCheckpoint, AgentCheckpointRepository } from "./agentCheckpoints";
import type { ToolAuditEvent } from "./tools";

const interrupted: AgentCheckpoint = {
  schemaVersion: 1, runId: "interrupted-1", agentId: "local",
  threadId: "local-thread", status: "running", sequence: 2,
  state: { payload: {}, permissionIndex: 1, steps: 0, agentVersion: "1" },
  createdAt: 10, updatedAt: 20
};
const repository: AgentCheckpointRepository = {
  get: async () => ok(interrupted),
  listByThread: async () => ok([interrupted]),
  save: async () => ok(undefined),
  delete: async () => ok(undefined)
};
const events: ToolAuditEvent[] = [
  { runId: "interrupted-1", traceId: "interrupted-1:1", toolId: "workspace.write",
    status: "started", timestamp: 15 }
];

describe("reconciling interrupted agent tool history", () => {
  it("surfaces unconfirmed external effects from an interrupted running checkpoint", async () => {
    const reconciler = new ToolReconciliationService({
      record: async () => ok(undefined), list: async () => ok(events)
    }, repository);
    expect(await reconciler.listAmbiguous("interrupted-1")).toEqual({ ok: true, value: [] });
    const result = await reconciler.listAmbiguous("interrupted-1", true);
    expect(result).toEqual({ ok: true, value: [{
      runId: "interrupted-1", toolId: "workspace.write",
      traceId: "interrupted-1:1", startedAt: 15
    }] });
  });

  it("still blocks Continue after reconciliation when a tool was never checkpointed", async () => {
    const reconciler = new ToolReconciliationService({
      record: async () => ok(undefined), list: async () => ok([
        ...events,
        { ...events[0], status: "reconciled", timestamp: 21 }
      ])
    }, repository);
    const result = await reconciler.verifySafeContinuation("interrupted-1", 0);
    expect(result.ok).toBe(false);
  });
});
