import type { AgentCheckpoint } from "../core/agentCheckpoints";
import { validateAgentCheckpoint } from "../core/agentCheckpoints";

/**
 * A fail-closed decision boundary for manual recovery. This module does not
 * execute tools, grant permissions, or mutate checkpoints.
 */
export type RecoveryDecision =
  | { allowed: true; checkpoint: AgentCheckpoint }
  | { allowed: false; reason: "invalid_checkpoint" | "not_interrupted" | "pending_approval" | "unreconciled_operation" | "permission_revalidation_required" | "concurrent_run" };

export interface RecoveryEvidence {
  /** A trusted runtime has established that no execution is currently active. */
  noActiveRun: boolean;
  /** All tool invocations have known, durable outcomes. */
  operationsReconciled: boolean;
  /** Current permissions were checked for this exact run, not inherited from the snapshot. */
  permissionsRevalidated: boolean;
}

/**
 * A persisted 'running' snapshot is only a candidate for manual recovery.
 * Never treat a snapshot or old approval as authorization to replay tools.
 */
export function evaluateManualRecovery(
  checkpoint: AgentCheckpoint,
  evidence: RecoveryEvidence
): RecoveryDecision {
  if (validateAgentCheckpoint(checkpoint)) return { allowed: false, reason: "invalid_checkpoint" };
  if (checkpoint.status === "waiting_for_approval" || checkpoint.pendingApproval) {
    return { allowed: false, reason: "pending_approval" };
  }
  if (checkpoint.status !== "running") return { allowed: false, reason: "not_interrupted" };
  if (!evidence.noActiveRun) return { allowed: false, reason: "concurrent_run" };
  if (!evidence.operationsReconciled) return { allowed: false, reason: "unreconciled_operation" };
  if (!evidence.permissionsRevalidated) return { allowed: false, reason: "permission_revalidation_required" };
  return { allowed: true, checkpoint };
}
