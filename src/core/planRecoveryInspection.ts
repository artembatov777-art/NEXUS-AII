import {
  validateAgentCheckpoint, type AgentCheckpoint,
  type AgentCheckpointRepository
} from "./agentCheckpoints";
import {
  MAX_TOOL_AUDIT_HISTORY_EVENTS, validateCompleteToolAuditHistory,
  type ToolAuditSink
} from "./tools";
import { findAmbiguous, type AmbiguousToolStep } from "./toolReconciliation";
import { err, ok, type Result } from "./result";

interface PlanStepIdentity { id: string; toolId: string }
export interface PlanRecoveryReport {
  runId: string;
  status: AgentCheckpoint["status"];
  confirmedSteps: number;
  totalSteps: number;
  inFlight: (PlanStepIdentity & { index: number }) | null;
  ambiguous: AmbiguousToolStep[];
  auditEvents: number;
  requiresOwnerReview: boolean;
  /** Recovery inspection never issues an executable authorization. */
  mayAutoResume: false;
}

interface PlanCheckpointIdentity {
  agentId: string;
  threadId: string;
  /** Optional separately namespaced checkpoint record for Desktop parents. */
  checkpointRunId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  } catch { return false; }
}

function validStep(value: unknown): value is PlanStepIdentity {
  return isRecord(value) && typeof value.id === "string" &&
    /^[A-Za-z0-9_-]{1,64}$/.test(value.id) &&
    typeof value.toolId === "string" &&
    /^[A-Za-z0-9._-]{1,120}$/.test(value.toolId);
}

function planState(value: unknown): { steps: PlanStepIdentity[];
  nextStep: number; active: (PlanStepIdentity & { index: number }) | null } | null {
  if (!isRecord(value) || value.kind !== "nexus.plan-run.v1" ||
      !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 12 ||
      Object.keys(value.steps).length !== value.steps.length ||
      !value.steps.every(validStep) ||
      !Number.isSafeInteger(value.nextStep) ||
      (value.nextStep as number) < 0 || (value.nextStep as number) > value.steps.length) return null;
  const index = value.nextStep as number;
  const active = value.active;
  if (active !== null && (!isRecord(active) ||
      !Number.isSafeInteger(active.index) || active.index !== index ||
      !validStep(active) ||
      value.steps[index]?.id !== active.id ||
      value.steps[index]?.toolId !== active.toolId)) return null;
  return { steps: value.steps, nextStep: index,
    active: active as (PlanStepIdentity & { index: number }) | null };
}

/**
 * Presentation-safe summary of a validated plan checkpoint. This does not
 * inspect external tool outcomes, grant permissions, or allow continuation.
 */
export function summarizePlanCheckpoint(checkpoint: AgentCheckpoint): {
  confirmedSteps: number;
  totalSteps: number;
  inFlight: (PlanStepIdentity & { index: number }) | null;
} | null {
  try {
    if (validateAgentCheckpoint(checkpoint) !== null) return null;
    const state = planState(checkpoint.state);
    if (!state || (checkpoint.status === "completed" &&
        (state.active !== null || state.nextStep !== state.steps.length)) ||
        (checkpoint.status === "waiting_for_approval" && state.active !== null)) return null;
    return { confirmedSteps: state.nextStep, totalSteps: state.steps.length,
      inFlight: state.active };
  } catch { return null; }
}

/**
 * Correlate *read-only* plan progress and tool audit for an owner-selected run.
 * This is not a restart protocol: even when the audit is complete and no
 * ambiguous receipt exists, no replay or continuation may be inferred.
 *
 * Desktop parent coordinators use a prefixed checkpoint ID and child tool
 * executions have independent audit run IDs. A caller must provide correct
 * host-specific mapping; lack of parent audit entries never proves no effect.
 */
export async function inspectPlanRecovery(
  runId: string,
  checkpoints: Pick<AgentCheckpointRepository, "get">,
  audit: Required<Pick<ToolAuditSink, "list">>,
  identity: PlanCheckpointIdentity
): Promise<Result<PlanRecoveryReport>> {
  if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(runId) ||
      !identity || typeof identity.agentId !== "string" ||
      typeof identity.threadId !== "string" || !identity.agentId.trim() ||
      !identity.threadId.trim()) return err("validation", "Recovery run and owner context must be valid.");

  const checkpointId = identity.checkpointRunId ?? runId;
  if (typeof checkpointId !== "string" ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(checkpointId)) {
    return err("validation", "Recovery checkpoint identity is invalid.");
  }
  try {
    const loaded = await checkpoints.get(checkpointId);
    if (!loaded.ok) return err("storage_failed", "Plan checkpoint cannot be verified.");
    if (!loaded.value) return err("validation", "No checkpoint exists for the requested run.");
    const cp = loaded.value;
    if (cp.runId !== checkpointId || cp.agentId !== identity.agentId ||
        cp.threadId !== identity.threadId ||
        validateAgentCheckpoint(cp) !== null) {
      return err("storage_failed", "Checkpoint identity or data is inconsistent.");
    }
    const state = planState(cp.state);
    if (!state || (cp.status === "completed" &&
        (state.active !== null || state.nextStep !== state.steps.length)) ||
        (cp.status === "waiting_for_approval" && state.active !== null)) {
      return err("storage_failed", "Plan checkpoint progress is malformed or inconsistent.");
    }
    const events = await audit.list({ runId, limit: MAX_TOOL_AUDIT_HISTORY_EVENTS });
    if (!events.ok || !validateCompleteToolAuditHistory(runId, events.value)) {
      return err("storage_failed",
        "Tool audit is unavailable, mixed, malformed or potentially truncated; review must stop.");
    }
    const ambiguous = findAmbiguous(events.value);
    const requiresOwnerReview = cp.status !== "completed" || state.active !== null ||
      ambiguous.length > 0 || events.value.length === 0;
    return ok({
      runId,
      status: cp.status,
      confirmedSteps: state.nextStep,
      totalSteps: state.steps.length,
      inFlight: state.active,
      ambiguous,
      auditEvents: events.value.length,
      requiresOwnerReview,
      mayAutoResume: false
    });
  } catch {
    return err("storage_failed", "Recovery evidence could not be inspected safely.");
  }
}
