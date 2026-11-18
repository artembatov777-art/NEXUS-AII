import type { ToolAuditEvent, ToolAuditSink } from "../core/tools";
import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";

const DEFAULT_KEY = "nexus-au:tool-audit:v1";
const MAX_EVENTS = 5_000;
const MAX_DETAIL_LENGTH = 1_000;

function isToolAuditEvent(value: unknown): value is ToolAuditEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<ToolAuditEvent>;
  return typeof event.toolId === "string" && event.toolId.length > 0 && event.toolId.length <= 160 &&
    typeof event.runId === "string" && event.runId.length > 0 && event.runId.length <= 160 &&
    typeof event.traceId === "string" && event.traceId.length > 0 && event.traceId.length <= 160 &&
    ["started", "completed", "failed", "denied", "reconciled"].includes(String(event.status)) &&
    typeof event.timestamp === "number" && Number.isFinite(event.timestamp) &&
    (event.detail === undefined || (typeof event.detail === "string" && event.detail.length <= MAX_DETAIL_LENGTH));
}

/**
 * Local preview adapter only. localStorage is not encrypted, tamper-proof, or
 * safe for concurrent writers across tabs. Production should use a native DB.
 */
export class LocalStorageToolAuditSink implements ToolAuditSink {
  constructor(private readonly storage: StorageLike, private readonly key = DEFAULT_KEY) {}

  async record(event: ToolAuditEvent): Promise<Result<void>> {
    if (!isToolAuditEvent(event)) return err("validation", "Tool audit event is invalid.");
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    const next = [...loaded.value, { ...event }].slice(-MAX_EVENTS);
    try {
      const serialized = JSON.stringify(next);
      if (new TextEncoder().encode(serialized).byteLength > 4 * 1024 * 1024) {
        return err("storage_failed", "Tool audit log reached its 4 MB storage limit.");
      }
      this.storage.setItem(this.key, serialized);
      return ok(undefined);
    } catch {
      return err("storage_failed", "Could not persist the tool audit event.", true);
    }
  }

  async list(options: { runId?: string; limit?: number } = {}): Promise<Result<ToolAuditEvent[]>> {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS) {
      return err("validation", `Audit limit must be from 1 to ${MAX_EVENTS}.`);
    }
    if (options.runId !== undefined && (!options.runId.trim() || options.runId.length > 160)) {
      return err("validation", "Audit run id is invalid.");
    }
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    return ok(loaded.value
      .filter(event => options.runId === undefined || event.runId === options.runId)
      .slice(-limit)
      .map(event => ({ ...event })));
  }

  private readAll(): Result<ToolAuditEvent[]> {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return ok([]);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > MAX_EVENTS || !parsed.every(isToolAuditEvent)) {
        return err("storage_failed", "Tool audit storage contains invalid or unsupported data.");
      }
      return ok(parsed);
    } catch {
      return err("storage_failed", "Could not read tool audit storage.", true);
    }
  }
}
