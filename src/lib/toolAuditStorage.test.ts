import { describe, expect, it, vi } from "vitest";
import { LocalStorageToolAuditSink } from "./toolAuditStorage";
import type { StorageLike } from "./memoryStorage";
import type { ToolAuditEvent } from "../core/tools";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const event = (overrides: Partial<ToolAuditEvent> = {}): ToolAuditEvent => ({
  toolId: "browser.search",
  runId: "run-1",
  traceId: "trace-1",
  status: "started",
  timestamp: 100,
  ...overrides
});

describe("LocalStorageToolAuditSink", () => {
  it("persists and lists events in append order", async () => {
    const sink = new LocalStorageToolAuditSink(new MemoryStorage());
    expect((await sink.record(event())).ok).toBe(true);
    expect((await sink.record(event({ status: "completed", timestamp: 200 }))).ok).toBe(true);
    const listed = await sink.list({ runId: "run-1" });
    expect(listed).toMatchObject({ ok: true, value: [{ status: "started" }, { status: "completed" }] });
  });

  it("filters by run and returns only the requested newest events", async () => {
    const sink = new LocalStorageToolAuditSink(new MemoryStorage());
    await sink.record(event());
    await sink.record(event({ runId: "run-2", timestamp: 200 }));
    await sink.record(event({ timestamp: 300 }));
    const listed = await sink.list({ runId: "run-1", limit: 1 });
    expect(listed).toMatchObject({ ok: true, value: [{ timestamp: 300 }] });
  });

  it("rejects malformed events and invalid list limits", async () => {
    const sink = new LocalStorageToolAuditSink(new MemoryStorage());
    expect((await sink.record(event({ detail: "x".repeat(1_001) }))).ok).toBe(false);
    expect((await sink.list({ limit: 0 })).ok).toBe(false);
  });

  it("fails closed when stored data is corrupt", async () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:tool-audit:v1", JSON.stringify([{ runId: "bad" }]));
    const sink = new LocalStorageToolAuditSink(storage);
    expect(await sink.list()).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect((await sink.record(event())).ok).toBe(false);
  });

  it("reports quota and storage exceptions without throwing", async () => {
    const storage: StorageLike = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(() => { throw new Error("quota"); })
    };
    const sink = new LocalStorageToolAuditSink(storage);
    expect(await sink.record(event())).toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });
});
