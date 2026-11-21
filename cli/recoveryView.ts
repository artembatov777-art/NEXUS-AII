import type { AgentCheckpointRepository } from "../src/core/agentCheckpoints";
import type { ToolAuditSink } from "../src/core/tools";
import { inspectPlanRecovery } from "../src/core/planRecoveryInspection";
import { quoteTerminal } from "./quote";

/**
 * Read-only diagnostic for a saved CLI run. Explicitly does not reconcile,
 * reauthorize, retry, mark a checkpoint finished, or contact a model.
 */
export async function renderRecoveryCommand(
  input: string,
  checkpoint: Pick<AgentCheckpointRepository, "get">,
  audit: Required<Pick<ToolAuditSink, "list">>
): Promise<string | null> {
  if (!/^\/recovery(?:\s|$)/.test(input)) return null;
  const match = /^\/recovery ([A-Za-z0-9_-]{1,120})$/.exec(input);
  if (!match) return "Usage: /recovery <run-id>\n";
  const runId = match[1];
  const inspected = await inspectPlanRecovery(runId, checkpoint, audit, {
    agentId: "nexus.cli.workspace", threadId: "workspace-cli"
  });
  if (!inspected.ok) {
    return "Recovery inspection is unavailable, unreadable, or unsafe: " +
      quoteTerminal(inspected.error.message) + "\nNo tool was executed.\n";
  }
  const report = inspected.value;
  const lines = [
    "Recovery inspection " + quoteTerminal(report.runId),
    "Checkpoint status: " + quoteTerminal(report.status),
    "Checkpoint-confirmed steps: " + report.confirmedSteps + "/" + report.totalSteps,
    "Audit-confirmed steps: " + report.auditConfirmedSteps + "/" + report.totalSteps,
    "Unmatched audit events: " + report.unmatchedAuditEvents,
    "Verified audit events: " + report.auditEvents,
    "Ambiguous audit actions: " + report.ambiguous.length,
    ...report.stepEvidence.map(step => "Step " + (step.index + 1) + ": " +
      quoteTerminal(step.toolId) + " · " + ({
        not_dispatched: "No dispatch recorded",
        missing_receipts: "Missing audit receipts",
        uncertain: "Uncertain outcome",
        confirmed: "Matching completion receipts"
      })[step.evidence]),

    report.inFlight
      ? "Unconfirmed dispatch: " + quoteTerminal(report.inFlight.toolId) +
         " (step " + (report.inFlight.index + 1) + ", ID " + quoteTerminal(report.inFlight.id) + ")"
      : "Checkpoint has no in-flight tool step.",
    ...report.ambiguous.slice(0, 10).map(item =>
      "Review " + quoteTerminal(item.toolId) + " trace=" + quoteTerminal(item.traceId)),
    report.requiresOwnerReview
      ? "Owner review required: compare the current external state with /audit status " + runId +
        " and /checkpoint " + runId + "."
      : "No incomplete plan step is recorded; this is not authorization to replay.",
    "Automatic recovery and tool replay are disabled. No files, checkpoints or audit events were changed."
  ];
  return lines.join("\n") + "\n";
}
