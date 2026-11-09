import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NativeToolAuditSink, NativeTraceSink } from "./nativeEventRepositories";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

describe("native event repositories", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("persists and lists tool audit events through native commands", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
      { toolId: "notes.search", runId: "run-1", traceId: "trace-1", status: "completed", timestamp: 10 }
    ]);
    const repository = new NativeToolAuditSink();
    const event = { toolId: "notes.search", runId: "run-1", traceId: "trace-1", status: "completed" as const, timestamp: 10 };
    expect(await repository.record(event)).toEqual({ ok: true, value: undefined });
    expect(await repository.list({ runId: "run-1", limit: 5 })).toMatchObject({ ok: true, value: [{ toolId: "notes.search" }] });
    expect(mockedInvoke).toHaveBeenNthCalledWith(1, "record_tool_audit_event", { event });
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, "list_tool_audit_events", { runId: "run-1", limit: 5 });
  });

  it("validates trace filters before calling the native host and persists trace events", async () => {
    const repository = new NativeTraceSink();
    expect(await repository.list({ limit: 0 })).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(mockedInvoke).not.toHaveBeenCalled();
    mockedInvoke.mockResolvedValueOnce(undefined);
    const event = { traceId: "trace-1", runId: "run-1", name: "agent.step", status: "completed" as const, timestamp: 10 };
    expect(await repository.append(event)).toEqual({ ok: true, value: undefined });
    expect(mockedInvoke).toHaveBeenCalledWith("append_trace_event", { event });
  });

  it("converts native command failures into storage Results", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("database unavailable"));
    const result = await new NativeTraceSink().append({
      traceId: "trace", runId: "run", name: "event", status: "started", timestamp: 1
    });
    expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });
});
