import {
  validateAgentCheckpoint, type AgentCheckpoint, type AgentCheckpointRepository
} from "./agentCheckpoints";
import { hasMatchingCompletionReceipts, summarizePlanCheckpoint } from "./planRecoveryInspection";
import { err, ok, type Result } from "./result";
import { MAX_TOOL_AUDIT_HISTORY_EVENTS, validateCompleteToolAuditHistory, type ToolAuditSink } from "./tools";
import { TOOL_INVOCATION_AGENT_ID } from "./toolInvocationAgent";

export type DelegatedRecoveryEvidence = "not_dispatched" | "unlinked" | "missing_checkpoint" | "uncertain" | "confirmed";
export interface DelegatedRecoveryStep {
  index: number;
  stepId: string;
  toolId: string;
  childRunId?: string;
  childStatus?: AgentCheckpoint["status"];
  evidence: DelegatedRecoveryEvidence;
  auditEvents: number;
}
export interface DesktopPlanRecoveryReport {
  parentCheckpointId: string;
  status: AgentCheckpoint["status"];
  confirmedSteps: number;
  totalSteps: number;
  steps: DelegatedRecoveryStep[];
  requiresOwnerReview: boolean;
  mayAutoResume: false;
}

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(id);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * Read-only, owner-thread-scoped correlation of a persisted parent plan with
 * its exact, reciprocally linked child runs. Never search by time or tool name
 * to guess links for old checkpoints. A missing receipt is not a safe retry.
 * Return only bounded metadata, never the child payload or raw audit details.
 */
export async function inspectDesktopPlanRecovery(
  parentCheckpointId: string,
  threadId: string,
  checkpoints: Pick<AgentCheckpointRepository, "get">,
  audit: Required<Pick<ToolAuditSink, "list">>
): Promise<Result<DesktopPlanRecoveryReport>> {
  if (!validId(parentCheckpointId) || !parentCheckpointId.startsWith("coord_") ||
      typeof threadId !== "string" || !threadId.trim() || threadId.length > 160 ||
      /[\u0000-\u001f\u007f]/.test(threadId)) {
    return err("validation", "A valid parent checkpoint and owner thread are required.");
  }
  const unavailable = () => err("storage_failed", "Parent or child recovery evidence is inconsistent or unavailable.");
  try {
    const loaded = await checkpoints.get(parentCheckpointId);
    if (!loaded.ok) return unavailable();
    const parent = loaded.value;
    if (!parent) return err("validation", "Parent plan checkpoint was not found.");
    if (parent.runId !== parentCheckpointId || parent.threadId !== threadId ||
        parent.agentId !== "nexus.desktop.workflow" || !record(parent.state)) return unavailable();
    const summary = summarizePlanCheckpoint(parent);
    if (!summary || !Array.isArray(parent.state.steps)) return unavailable();
    const steps = parent.state.steps;
    const attempted = summary.confirmedSteps + (summary.inFlight ? 1 : 0);
    const links = parent.state.childRuns;
    const byIndex = new Map<number, string>();
    const childIds = new Set<string>();
    if (links !== undefined) {
      if (!Array.isArray(links) || links.length > attempted ||
          Object.keys(links).length !== links.length) return unavailable();
      for (const link of links) {
        if (!record(link) || !Number.isSafeInteger(link.index) ||
            typeof link.index !== "number" || link.index < 0 || link.index >= attempted ||
            !validId(link.runId) || link.runId === parentCheckpointId ||
            byIndex.has(link.index) || childIds.has(link.runId)) return unavailable();
        byIndex.set(link.index, link.runId);
        childIds.add(link.runId);
      }
    }
    const result: DelegatedRecoveryStep[] = [];
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (!record(step) || typeof step.id !== "string" || typeof step.toolId !== "string") return unavailable();
      const row: DelegatedRecoveryStep = {
        index, stepId: step.id, toolId: step.toolId,
        evidence: index < attempted ? "unlinked" : "not_dispatched", auditEvents: 0
      };
      const childRunId = byIndex.get(index);
      if (!childRunId) { result.push(row); continue; }
      row.childRunId = childRunId;
      const loadedChild = await checkpoints.get(childRunId);
      if (!loadedChild.ok) return unavailable();
      const child = loadedChild.value;
      if (!child) {
        row.evidence = "missing_checkpoint";
        result.push(row);
        continue;
      }
      // Verify ownership and reciprocal linkage before reading child audit.
      if (validateAgentCheckpoint(child) !== null ||
          child.runId !== childRunId || child.threadId !== threadId ||
          child.agentId !== TOOL_INVOCATION_AGENT_ID ||
          !record(child.state) || !record(child.state.delegation) ||
          child.state.delegation.parentCheckpointId !== parentCheckpointId ||
          child.state.delegation.stepIndex !== index ||
          !record(child.state.payload) || child.state.payload.toolId !== step.toolId ||
          child.state.agentVersion !== "1.0.0" ||
          child.createdAt < parent.createdAt) return unavailable();
      row.childStatus = child.status;
      const events = await audit.list({ runId: childRunId, limit: MAX_TOOL_AUDIT_HISTORY_EVENTS });
      if (!events.ok || !validateCompleteToolAuditHistory(childRunId, events.value) ||
          events.value.some(event => event.toolId !== step.toolId || event.traceId !== childRunId + ":1")) {
        return unavailable();
      }
      row.auditEvents = events.value.length;
      // A successful one-step tool invocation must have exactly one start and
      // one completion receipt in append order, as well as a completed child.
      // All other sequences (including reconciliation) remain review-only.
      const receipts = events.value;
      row.evidence = child.status === "completed" &&
        child.state.steps === 1 && hasMatchingCompletionReceipts(receipts)
        ? "confirmed" : "uncertain";
      result.push(row);
    }
    // This report is a read-only snapshot, not a lease. If the parent has
    // changed since we began, require another inspection rather than mix eras.
    const latest = await checkpoints.get(parentCheckpointId);
    if (!latest.ok || !latest.value || latest.value.sequence !== parent.sequence ||
        latest.value.runId !== parentCheckpointId || latest.value.threadId !== threadId ||
        latest.value.agentId !== parent.agentId ||
        latest.value.status !== parent.status ||
        JSON.stringify(latest.value.state) !== JSON.stringify(parent.state)) return unavailable();
    return ok({
      parentCheckpointId, status: parent.status, confirmedSteps: summary.confirmedSteps,
      totalSteps: summary.totalSteps, steps: result,
      requiresOwnerReview: parent.status !== "completed" ||
        result.some(step => step.evidence !== "confirmed"),
      mayAutoResume: false
    });
  } catch { return unavailable(); }
}
