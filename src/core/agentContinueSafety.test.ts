import { describe, expect, it } from "vitest";
import { ToolReconciliationService } from "./toolReconciliation";
import { ok } from "./result";
import type { ToolAuditEvent } from "./tools";
import type { AgentCheckpoint, AgentCheckpointRepository } from "./agentCheckpoints";

const cp: AgentCheckpoint = {
  schemaVersion: 1, runId: "run-1", agentId: "a", threadId: "t", sequence: 2,
  status: "running", createdAt: 1, updatedAt: 2,
  state: { payload: {}, agentVersion: "1", steps: 1, permissionIndex: 0 }
};
const repository = (): AgentCheckpointRepository => ({
  get: async () => ok(cp), save: async () => ok(undefined),
  listByThread: async () => ok([]), delete: async () => ok(undefined)
});
const event = (traceId: string, status: ToolAuditEvent["status"]): ToolAuditEvent => ({
  runId: "run-1", toolId: "workspace.read", traceId, status, timestamp: 50
});

describe("continue recovery audit barriers", () => {
  it("allows a read-only prior step that has already been durably checkpointed", async () => {
    const svc = new ToolReconciliationService({
      record: async () => ok(undefined),
      list: async () => ok([event("run-1:1", "started"), event("run-1:1", "completed")])
    }, repository());
    expect(await svc.verifySafeContinuation("run-1", 1)).toEqual({ ok: true, value: undefined });
  });
  it("blocks a completed side effect when its checkpoint step is missing", async () => {
    const svc = new ToolReconciliationService({
      record: async () => ok(undefined),
      list: async () => ok([event("run-1:2", "started"), event("run-1:2", "completed")])
    }, repository());
    expect((await svc.verifySafeContinuation("run-1", 1)).ok).toBe(false);
  });
  it("blocks any uncertain started tool invocation from replay", async () => {
    const svc = new ToolReconciliationService({
      record: async () => ok(undefined),
      list: async () => ok([event("run-1:2", "started")])
    }, repository());
    expect((await svc.verifySafeContinuation("run-1", 1)).ok).toBe(false);
  });
  it("fails closed when audit history is unavailable", async () => {
    const svc = new ToolReconciliationService({
      record: async () => ok(undefined),
      list: async () => ({ ok: false as const, error: { code: "storage_failed" as const, message: "Unavailable", retryable: true } })
    }, repository());
    expect((await svc.verifySafeContinuation("run-1", 1)).ok).toBe(false);
  });
  it("does not mistake a pre-execution denial for an executed tool", async () => {
    const svc = new ToolReconciliationService({
      record: async () => ok(undefined),
      list: async () => ok([event("run-1:2", "denied")])
    }, repository());
    expect(await svc.verifySafeContinuation("run-1", 1)).toEqual({ ok: true, value: undefined });
  });
});
