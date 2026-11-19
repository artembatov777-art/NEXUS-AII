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
  it("checkpoint running evidence 0 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 0 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 0 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 0 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 0 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 1 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "unreconciled_operation" });
  });
  it("checkpoint running evidence 1 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 1 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "unreconciled_operation" });
  });
  it("checkpoint running evidence 1 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 1 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "unreconciled_operation" });
  });
  it("checkpoint running evidence 1 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 2 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 2 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 2 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 2 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 2 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 2 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 3 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "permission_revalidation_required" });
  });
  it("checkpoint running evidence 3 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 3 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "permission_revalidation_required" });
  });
  it("checkpoint running evidence 3 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 3 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "permission_revalidation_required" });
  });
  it("checkpoint running evidence 3 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 4 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 4 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 4 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 4 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 4 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 4 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 5 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "unreconciled_operation" });
  });
  it("checkpoint running evidence 5 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 5 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "unreconciled_operation" });
  });
  it("checkpoint running evidence 5 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 5 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "unreconciled_operation" });
  });
  it("checkpoint running evidence 5 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 6 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 6 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 6 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 6 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 6 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "concurrent_run" });
  });
  it("checkpoint running evidence 6 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 7 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: true, checkpoint });
  });
  it("checkpoint running evidence 7 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 7 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: true, checkpoint });
  });
  it("checkpoint running evidence 7 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint running evidence 7 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: true, checkpoint });
  });
  it("checkpoint running evidence 7 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "running", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint waiting_for_approval evidence 0 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 0 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 0 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 0 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 0 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 0 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 1 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 1 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 1 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 1 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 1 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 1 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 2 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 2 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 2 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 2 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 2 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 2 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 3 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 3 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 3 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 3 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 3 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 3 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 4 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 4 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 4 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 4 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 4 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 4 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 5 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 5 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 5 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 5 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 5 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 5 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 6 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 6 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 6 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 6 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 6 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 6 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 7 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 7 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 7 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 7 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 7 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint waiting_for_approval evidence 7 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "waiting_for_approval", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "pending_approval" });
  });
  it("checkpoint completed evidence 0 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 0 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 0 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 0 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 0 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 0 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 1 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 1 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 1 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 1 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 1 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 1 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 2 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 2 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 2 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 2 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 2 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 2 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 3 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 3 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 3 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 3 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 3 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 3 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 4 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 4 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 4 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 4 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 4 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 4 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 5 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 5 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 5 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 5 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 5 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 5 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 6 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 6 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 6 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 6 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 6 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 6 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 7 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 7 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 7 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 7 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint completed evidence 7 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint completed evidence 7 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "completed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 0 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 0 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 0 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 0 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 0 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 0 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 1 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 1 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 1 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 1 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 1 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 1 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 2 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 2 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 2 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 2 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 2 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 2 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 3 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 3 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 3 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 3 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 3 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 3 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 4 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 4 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 4 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 4 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 4 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 4 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 5 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 5 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 5 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 5 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 5 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 5 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 6 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 6 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 6 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 6 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 6 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 6 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 7 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 7 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 7 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 7 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint failed evidence 7 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint failed evidence 7 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "failed", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 0 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 0 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 0 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 0 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 0 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 0 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 1 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 1 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 1 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 1 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 1 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 1 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 2 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 2 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 2 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 2 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 2 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 2 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 3 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 3 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 3 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 3 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 3 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 3 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: false };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 4 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 4 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 4 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 4 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 4 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 4 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 5 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 5 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 5 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 5 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 5 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 5 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: false, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 6 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 6 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 6 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 6 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 6 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 6 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: false, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 7 sequence 1 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 7 sequence 1 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 1, updatedAt: 101, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 7 sequence 2 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 7 sequence 2 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 2, updatedAt: 102, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("checkpoint cancelled evidence 7 sequence 17 approval false", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117 };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "not_interrupted" });
  });
  it("checkpoint cancelled evidence 7 sequence 17 approval true", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, status: "cancelled", sequence: 17, updatedAt: 117, pendingApproval: { permission: "tool:execute", requestedAt: 100 } };
    const evidence: RecoveryEvidence = { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true };
    expect(evaluateManualRecovery(checkpoint, evidence)).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("rejects control U+0000 in runId", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, runId: "id" + String.fromCharCode(0) + "x" };
    expect(evaluateManualRecovery(checkpoint, { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true })).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("rejects control U+0001 in runId", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, runId: "id" + String.fromCharCode(1) + "x" };
    expect(evaluateManualRecovery(checkpoint, { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true })).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("rejects control U+0002 in runId", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, runId: "id" + String.fromCharCode(2) + "x" };
    expect(evaluateManualRecovery(checkpoint, { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true })).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("rejects control U+0003 in runId", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, runId: "id" + String.fromCharCode(3) + "x" };
    expect(evaluateManualRecovery(checkpoint, { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true })).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("rejects control U+0004 in runId", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, runId: "id" + String.fromCharCode(4) + "x" };
    expect(evaluateManualRecovery(checkpoint, { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true })).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
  it("rejects control U+0005 in runId", () => {
    const checkpoint: AgentCheckpoint = { ...baseline, runId: "id" + String.fromCharCode(5) + "x" };
    expect(evaluateManualRecovery(checkpoint, { noActiveRun: true, operationsReconciled: true, permissionsRevalidated: true })).toEqual({ allowed: false, reason: "invalid_checkpoint" });
  });
});
