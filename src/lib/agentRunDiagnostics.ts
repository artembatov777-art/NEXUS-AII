import type { AgentCheckpoint } from "../core/agentCheckpoints";
import type { ToolAuditEvent } from "../core/tools";
import type { TraceEvent } from "../core/observability";

/** Human-readable troubleshooting data only, never raw state, outputs or secrets. */
export function formatAgentRunDiagnostics(
  checkpoint: AgentCheckpoint,
  audit: readonly ToolAuditEvent[],
  traces: readonly TraceEvent[]
): string {
  const ownAudit = audit.filter(event => event.runId === checkpoint.runId);
  const ownTraces = traces.filter(event => event.runId === checkpoint.runId);
  const MAX_EVENTS = 40;
  const lines: string[] = [
    "NEXUS AU / Agent run diagnostics",
    "Run: " + checkpoint.runId,
    "Agent: " + checkpoint.agentId,
    "Status: " + checkpoint.status,
    "Checkpoint: " + checkpoint.sequence,
    "Updated: " + new Date(checkpoint.updatedAt).toISOString(),
    "Audit entries: " + ownAudit.length,
    "Trace entries: " + ownTraces.length,
    "",
    "Tool audit (metadata only)"
  ];
  for (const event of ownAudit.slice(-MAX_EVENTS)) {
    // Never include detail, input/output or arbitrary external responses.
    lines.push(event.status + " | " + event.toolId + " | " + event.timestamp);
  }
  if (ownAudit.length > MAX_EVENTS) lines.push((ownAudit.length - MAX_EVENTS) + " audit events omitted");
  lines.push("", "Agent trace (metadata only)");
  for (const event of ownTraces.slice(-MAX_EVENTS)) {
    lines.push(event.status + " | " + event.name + " | " + event.timestamp);
  }
  if (ownTraces.length > MAX_EVENTS) lines.push((ownTraces.length - MAX_EVENTS) + " trace events omitted");
  return lines.join("\n").slice(0, 18_000);
}
