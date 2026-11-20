import type { Result } from "../src/core/result";
import { MAX_TOOL_AUDIT_HISTORY_EVENTS, type ToolAuditEvent } from "../src/core/tools";
import { findAmbiguous } from "../src/core/toolReconciliation";
import { quoteTerminal } from "./quote";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_DETAIL_PREVIEW = 160;
const USAGE = "Usage: /audit <run-id> [last <1-50>] | /audit status <run-id> | /audit recent [1-50] | /audit locks [1-50]\n";

interface AuditReader {
  list(options: { runId: string; limit: number }): Promise<Result<ToolAuditEvent[]>>;
  recent?(limit: number): Promise<Result<Array<{ runId: string; updatedAt: number }>>>;
  locked?(limit: number): Promise<Result<Array<{ runId: string; updatedAt: number }>>>;
}

function preview(value: string): string {
  const characters = Array.from(value);
  const text = characters.length > MAX_DETAIL_PREVIEW
    ? characters.slice(0, MAX_DETAIL_PREVIEW).join("") + "…"
    : value;
  return quoteTerminal(text);
}

function safeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) return "invalid timestamp";
  return new Date(timestamp).toISOString();
}

/** View tool receipts without executing a tool, contacting a model, or editing the audit. */
export async function renderAuditCommand(input: string, audit: AuditReader): Promise<string | null> {
  const command = input.trim();
  if (!/^\/audit(?:\s|$)/.test(command)) return null;
  if (/^\/audit locks(?:\s|$)/.test(command)) {
    const matched = /^\/audit locks(?: (\d+))?$/.exec(command);
    if (!matched) return USAGE;
    const limit = matched[1] === undefined ? 10 : Number(matched[1]);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) return USAGE;
    if (!audit.locked) return "Audit lock inspection is unavailable.\n";
    let result: Result<Array<{ runId: string; updatedAt: number }>>;
    try { result = await audit.locked(limit); }
    catch { return "Audit lock inspection is unavailable or unsafe.\n"; }
    if (!result.ok) return "Audit lock inspection is unavailable or unreadable.\n";
    if (!result.value.length) return "No audit writer locks found.\n";
    const records = result.value.slice(0, limit);
    return `Audit writer locks (${records.length}; active or interrupted, inspect before retrying):\n${records.map(item => `${safeTime(item.updatedAt)}  ${quoteTerminal(item.runId)}`).join("\n")}\n`;
  }
  if (/^\/audit recent(?:\s|$)/.test(command)) {
    const recent = /^\/audit recent(?: (\d+))?$/.exec(command);
    if (!recent) return USAGE;
    const limit = recent[1] === undefined ? 10 : Number(recent[1]);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) return USAGE;
    if (!audit.recent) return "Recent audit discovery is unavailable.\n";
    let results: Result<Array<{ runId: string; updatedAt: number }>>;
    try { results = await audit.recent(limit); }
    catch { return "Recent audit discovery is unavailable or unsafe.\n"; }
    if (!results.ok) return "Recent audit discovery is unavailable or unreadable.\n";
    if (!results.value.length) return "No audit runs found.\n";
    const visible = results.value.slice(0, limit);
    return `Recent audit runs (${visible.length}):\n${visible.map(item => `${safeTime(item.updatedAt)}  ${quoteTerminal(item.runId)}`).join("\n")}\n`;
  }
  if (/^\/audit status(?:\s|$)/.test(command)) {
    const matchedStatus = /^\/audit status ([A-Za-z0-9_-]{1,120})$/.exec(command);
    if (!matchedStatus) return USAGE;
    const runId = matchedStatus[1];
    let result: Result<ToolAuditEvent[]>;
    try { result = await audit.list({ runId, limit: MAX_TOOL_AUDIT_HISTORY_EVENTS }); }
    catch { return "Full audit journal is unavailable or unsafe. No tool was executed.\n"; }
    if (!result.ok || !Array.isArray(result.value) ||
        result.value.length > MAX_TOOL_AUDIT_HISTORY_EVENTS ||
        result.value.some(event => !event || event.runId !== runId ||
          typeof event.toolId !== "string" || typeof event.traceId !== "string" ||
          !["started", "completed", "failed", "denied", "reconciled"].includes(event.status) ||
          !Number.isFinite(event.timestamp))) {
      return "Full audit journal is unavailable or unreadable. No tool was executed.\n";
    }
    if (!result.value.length) {
      return "No audit events for " + quoteTerminal(runId) +
        ". This does not prove no external effects; inspect /audit locks before retrying.\n";
    }
    // Use exactly the same ambiguous-outcome algorithm as Desktop manual
    // reconciliation. Incomplete and failed post-dispatch steps may have had
    // real effects and must not be replayed merely because an audit is sparse.
    const ambiguous = findAmbiguous(result.value);
    const header = "Audit status " + quoteTerminal(runId) + ": " +
      result.value.length + " recorded events, " + ambiguous.length +
      " ambiguous tool step(s) requiring owner review.\n";
    if (!ambiguous.length) {
      return header + "No ambiguous steps found in this journal. This is not proof of external outcomes or permission to retry.\n";
    }
    const visible = ambiguous.slice(0, 20).map(step => [
      safeTime(step.startedAt), preview(step.toolId),
      "trace=" + preview(step.traceId),
      "outcome requires inspection"
    ].join("  "));
    return header + visible.join("\n") +
      (ambiguous.length > visible.length ? "\nOnly the first " + visible.length + " ambiguous steps are shown." : "") +
      "\nNo automatic retry was authorized.\n";
  }
  const matched = /^\/audit ([A-Za-z0-9_-]{1,120})(?: last (\d+))?$/.exec(command);
  if (!matched) return USAGE;
  const runId = matched[1];
  const limit = matched[2] === undefined ? DEFAULT_LIMIT : Number(matched[2]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) return USAGE;

  let result: Result<ToolAuditEvent[]>;
  try { result = await audit.list({ runId, limit }); }
  catch { return "Audit journal is unavailable or unsafe. No tool was executed.\n"; }
  if (!result.ok) return "Audit journal is unavailable or unreadable. No tool was executed.\n";
  if (!result.value.length) return `No audit events for ${quoteTerminal(runId)}.\n`;

  const lines = result.value.slice(-limit).map(event => [
    safeTime(event.timestamp), preview(event.status), preview(event.toolId),
    `trace=${preview(event.traceId)}`,
    ...(event.detail ? [`detail=${preview(event.detail)}`] : [])
  ].join("  "));
  return `Audit ${quoteTerminal(runId)}: ${lines.length} events (last ${limit}):\n${lines.join("\n")}\n`;
}
