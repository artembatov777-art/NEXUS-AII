import type { Result } from "../src/core/result";
import type { ToolAuditEvent } from "../src/core/tools";
import { quoteTerminal } from "./quote";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_DETAIL_PREVIEW = 160;
const USAGE = "Usage: /audit <run-id> [last <1-50>]\n";

interface AuditReader {
  list(options: { runId: string; limit: number }): Promise<Result<ToolAuditEvent[]>>;
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
