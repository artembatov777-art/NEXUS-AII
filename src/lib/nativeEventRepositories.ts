import { invoke } from "@tauri-apps/api/core";
import { err, ok, type Result } from "../core/result";
import type { ToolAuditEvent, ToolAuditSink } from "../core/tools";
import type { TraceEvent, TraceSink } from "../core/observability";

function storageFailure(error: unknown, fallback: string): Result<never> {
  return err("storage_failed", error instanceof Error ? error.message : fallback, true);
}

/** Transactional SQLite-backed audit history for the native desktop host. */
export class NativeToolAuditSink implements ToolAuditSink {
  async record(event: ToolAuditEvent): Promise<Result<void>> {
    try {
      await invoke("record_tool_audit_event", { event });
      return ok(undefined);
    } catch (error) {
      return storageFailure(error, "Could not persist native tool audit event.");
    }
  }

  async list(options: { runId?: string; limit?: number } = {}): Promise<Result<ToolAuditEvent[]>> {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 5_000 ||
        (options.runId !== undefined && (!options.runId.trim() || options.runId.length > 160))) {
      return err("validation", "Audit filter or limit is invalid.");
    }
    try {
      return ok(await invoke<ToolAuditEvent[]>("list_tool_audit_events", {
        runId: options.runId ?? null,
        limit
      }));
    } catch (error) {
      return storageFailure(error, "Could not load native tool audit history.");
    }
  }
}

/** Transactional SQLite-backed observability history for the native desktop host. */
export class NativeTraceSink implements TraceSink {
  async append(event: TraceEvent): Promise<Result<void>> {
    try {
      await invoke("append_trace_event", { event });
      return ok(undefined);
    } catch (error) {
      return storageFailure(error, "Could not persist native trace event.");
    }
  }

  async list(filter: { runId?: string; traceId?: string; limit?: number } = {}): Promise<Result<TraceEvent[]>> {
    const limit = filter.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000 ||
        (filter.runId !== undefined && (!filter.runId.trim() || filter.runId.length > 160)) ||
        (filter.traceId !== undefined && (!filter.traceId.trim() || filter.traceId.length > 160))) {
      return err("validation", "Trace filter or limit is invalid.");
    }
    try {
      return ok(await invoke<TraceEvent[]>("list_trace_events", {
        runId: filter.runId ?? null,
        traceId: filter.traceId ?? null,
        limit
      }));
    } catch (error) {
      return storageFailure(error, "Could not load native trace history.");
    }
  }
}
