import type { AgentCheckpointRepository } from "./agentCheckpoints";
import { err, ok, type Result } from "./result";
import type { ToolAuditEvent, ToolAuditSink } from "./tools";

export interface AmbiguousToolStep {
  toolId: string;
  runId: string;
  traceId: string;
  startedAt: number;
}

type ListableAuditSink = ToolAuditSink & Required<Pick<ToolAuditSink, "list">>;

/**
 * Manual reconciliation never reruns a tool or claims its external result.
 * It records that the owner inspected the external system and wants this step
 * permanently blocked from automatic replay.
 */
export class ToolReconciliationService {
  constructor(
    private readonly audit: ListableAuditSink,
    private readonly checkpoints: AgentCheckpointRepository,
    private readonly now: () => number = () => Date.now()
  ) {}

  async listAmbiguous(runId: string): Promise<Result<AmbiguousToolStep[]>> {
    if (!validId(runId)) return err("validation", "A valid run ID is required.");
    const checkpoint = await this.checkpoints.get(runId);
    if (!checkpoint.ok) return checkpoint;
    if (!checkpoint.value || !["failed", "cancelled"].includes(checkpoint.value.status)) return ok([]);

    const events = await this.audit.list({ runId, limit: 500 });
    if (!events.ok) return events;
    return ok(findAmbiguous(events.value));
  }

  async reconcile(
    runId: string,
    toolId: string,
    traceId: string,
    confirmedByUser: boolean
  ): Promise<Result<void>> {
    if (!validId(runId) || !validId(toolId) || !validId(traceId)) {
      return err("validation", "Tool reconciliation identifiers are invalid.");
    }
    if (confirmedByUser !== true) {
      return err("permission_denied", "Manual tool reconciliation requires explicit owner confirmation.");
    }
    const ambiguous = await this.listAmbiguous(runId);
    if (!ambiguous.ok) return ambiguous;
    if (!ambiguous.value.some(item => item.toolId === toolId && item.traceId === traceId)) {
      return err("validation", "This tool step is not awaiting manual reconciliation.");
    }
    return this.audit.record({
      toolId, runId, traceId, status: "reconciled", timestamp: this.now(),
      detail: "Owner reviewed the external outcome. No tool retry was executed."
    });
  }
}

function validId(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 160 && !/[\\u0000-\\u001f\\u007f]/.test(value);
}

function findAmbiguous(events: ToolAuditEvent[]): AmbiguousToolStep[] {
  const pending = new Map<string, AmbiguousToolStep>();
  for (const event of events) {
    const key = JSON.stringify([event.toolId, event.traceId]);
    if (event.status === "started") {
      pending.set(key, {
        toolId: event.toolId, runId: event.runId,
        traceId: event.traceId, startedAt: event.timestamp
      });
    } else {
      pending.delete(key);
    }
  }
  return [...pending.values()].sort((a, b) => a.startedAt - b.startedAt);
}
