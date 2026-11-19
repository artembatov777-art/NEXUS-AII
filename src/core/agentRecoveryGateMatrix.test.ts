import { describe, expect, it } from "vitest";
import { evaluateManualRecovery, type RecoveryEvidence } from "./agentRecoveryGate";
import type { AgentCheckpoint } from "./agentCheckpoints";

const baseline: AgentCheckpoint = {
  schemaVersion: 1, runId: "run", agentId: "agent", threadId: "thread",
  sequence: 1, status: "running", state: { progress: 0 }, createdAt: 100, updatedAt: 101
};

describe("manual recovery gate safety matrix", () => {
  it("checkpoint running evidence 0 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
});
