import { describe, expect, it } from "vitest";
import { evaluateManualRecovery, type RecoveryEvidence } from "./agentRecoveryGate";
import type { AgentCheckpoint } from "./agentCheckpoints";

const checkpoint: AgentCheckpoint = {
  schemaVersion: 1, runId: "run", agentId: "agent",
  threadId: "thread", sequence: 1, status: "running",
  state: {}, createdAt: 100, updatedAt: 100
};
const evidence: RecoveryEvidence = {
  noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true
};

describe("evaluateManualRecovery", () => {
  it("requires independent, fresh safety evidence", () => {
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: true, checkpoint });
    for (const key of Object.keys(evidence) as (keyof RecoveryEvidence)[]) {
      const result = evaluateManualRecovery(checkpoint, { ...evidence, [key]: false });
      expect(result.allowed).toBe(false);
    }
  });

  it("never treats approval-waiting or terminal checkpoints as resumable", () => {
    const statuses = ["waiting_for_approval", "completed", "failed", "cancelled"] as const;
    for (const status of statuses) {
      expect(evaluateManualRecovery({ ...checkpoint, status }, evidence).allowed).toBe(false);
    }
    expect(evaluateManualRecovery({
      ...checkpoint, status: "waiting_for_approval",
      pendingApproval: { permission: "workspace:write", requestedAt: 100 }
    }, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });

  it("rejects invalid snapshots even when all evidence is true", () => {
    expect(evaluateManualRecovery({
      ...checkpoint, state: { value: Number.NaN }
    }, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });

  it("returns precise failure reasons for operator diagnostics", () => {
    expect(evaluateManualRecovery(checkpoint, { ...evidence, noActiveRun: false }))
      .toEqual({ allowed: false, reason: "concurrent_run" });
    expect(evaluateManualRecovery(checkpoint, { ...evidence, operationsReconciled: false }))
      .toEqual({ allowed: false, reason: "unreconciled_operation" });
    expect(evaluateManualRecovery(checkpoint, { ...evidence, permissionsRevalidated: false }))
      .toEqual({ allowed: false, reason: "permission_revalidation_required" });
  });
});
