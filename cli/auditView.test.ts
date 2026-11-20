import { describe, expect, it, vi } from "vitest";
import { ok, err } from "../src/core/result";
import type { ToolAuditEvent } from "../src/core/tools";
import { renderAuditCommand } from "./auditView";

const sample: ToolAuditEvent[] = [
  { runId: "run-1", toolId: "cli.workspace.read", traceId: "step-1", status: "started", timestamp: 1_000 },
  { runId: "run-1", toolId: "cli.workspace.read", traceId: "step-1", status: "completed", timestamp: 1_100 },
  { runId: "run-1", toolId: "cli.workspace.search", traceId: "step-2", status: "denied", timestamp: 1_200, detail: "Permission denied." }
];

describe("read-only workspace audit terminal command", () => {
  it("shows bounded, timestamped tool activity from a specific run", async () => {
    const audit = { list: vi.fn(async () => ok(sample)) };
    const output = await renderAuditCommand("/audit run-1", audit);
    expect(output).toContain("run-1");
    expect(output).toContain("3 event");
    expect(output).toContain("cli.workspace.read");
    expect(output).toContain("completed");
    expect(output).toContain("Permission denied.");
    expect(audit.list).toHaveBeenCalledWith({ runId: "run-1", limit: 20 });
  });

  it("accepts a numeric limit and rejects invalid IDs before reading", async () => {
    const audit = { list: vi.fn(async () => ok(sample.slice(-1))) };
    const output = await renderAuditCommand("/audit run-1 last 1", audit);
    expect(output).toContain("cli.workspace.search");
    expect(audit.list).toHaveBeenCalledWith({ runId: "run-1", limit: 1 });
    for (const input of ["/audit ../bad", "/audit", "/audit run-1 last 0", "/audit run-1 last 51", "/audit run-1 delete"]) {
      expect(await renderAuditCommand(input, audit)).toContain("Usage: /audit");
    }
    expect(audit.list).toHaveBeenCalledTimes(1);
    expect(await renderAuditCommand("/agent plan", audit)).toBeNull();
  });

  it("does not display raw terminal controls from unexpected audit adapter content", async () => {
    const audit = { list: async () => ok([{ ...sample[0], detail: "bad\u001b[31m\u202e\nline" }]) };
    const output = await renderAuditCommand("/audit run-1", audit);
    expect(output).toContain("\\u001b");
    expect(output).toContain("\\u202e");
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\u202e");
    expect(output).not.toContain("bad\nline");
  });

  it("reports corrupted journals without interpreting them as empty history", async () => {
    const audit = { list: async () => err("storage_failed", "Unreadable audit", true) };
    const output = await renderAuditCommand("/audit run-1", audit);
    expect(output).toMatch(/unavailable|unreadable|unsafe/i);
    expect(output).not.toContain("No audit events");
  });

  it("reports an empty valid journal without inventing tool activity", async () => {
    const audit = { list: async () => ok([] as ToolAuditEvent[]) };
    expect(await renderAuditCommand("/audit run-1", audit)).toContain("No audit events");
  });

  it("shows recent run identifiers so an owner can locate existing tool receipts", async () => {
    const audit = {
      list: vi.fn(async () => ok(sample)),
      recent: vi.fn(async () => ok([
        { runId: "run-2", updatedAt: 2_000 },
        { runId: "run-1", updatedAt: 1_000 }
      ]))
    };
    const result = await renderAuditCommand("/audit recent", audit);
    expect(result).toContain("Recent audit runs");
    expect(result).toContain("run-2");
    expect(result).toContain("run-1");
    expect(audit.recent).toHaveBeenCalledWith(10);
    expect(audit.list).not.toHaveBeenCalled();
    expect(await renderAuditCommand("/audit recent 1", audit)).toContain("run-2");
    expect(audit.recent).toHaveBeenCalledWith(1);
    expect(await renderAuditCommand("/audit recent 0", audit)).toContain("Usage: /audit");
  });

  it("shows stranded or active writer locks as inspection-only evidence", async () => {
    const locked = vi.fn(async () => ok([{ runId: "run-9", updatedAt: 1_000 }]));
    const reader = { list: vi.fn(async () => ok(sample)), locked };
    const output = await renderAuditCommand("/audit locks", reader);
    expect(output).toContain("run-9");
    expect(output).toMatch(/lock|writer/i);
    expect(output).toMatch(/inspect|review/i);
    expect(locked).toHaveBeenCalledWith(10);
    expect(reader.list).not.toHaveBeenCalled();
    await renderAuditCommand("/audit locks 1", reader);
    expect(locked).toHaveBeenCalledWith(1);
    expect(await renderAuditCommand("/audit locks 0", reader)).toContain("Usage: /audit");
    expect(await renderAuditCommand("/audit locks 51", reader)).toContain("Usage: /audit");
  });

  it("makes invalid lock evidence visible rather than assuming no locks exist", async () => {
    const reader = {
      list: async () => ok(sample),
      locked: async () => err("storage_failed", "Unsafe writer lock", true)
    };
    const output = await renderAuditCommand("/audit locks", reader);
    expect(output).toMatch(/unavailable|unsafe|unreadable/i);
    expect(output).not.toContain("No audit writer locks");
  });
});
