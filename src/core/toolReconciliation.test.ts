import { describe, expect, it, vi } from "vitest";
import { ToolReconciliationService, findAmbiguous } from "./toolReconciliation";
import type { AgentCheckpoint, AgentCheckpointRepository } from "./agentCheckpoints";
import type { ToolAuditEvent, ToolAuditSink } from "./tools";
import { ok } from "./result";

const checkpoint = (status: AgentCheckpoint["status"]): AgentCheckpoint => ({
  schemaVersion: 1, runId: "run-1", agentId: "agent-1", threadId: "thread-1",
  sequence: 2, status, state: {}, createdAt: 1, updatedAt: 2
});

class FakeAudit implements ToolAuditSink {
  events: ToolAuditEvent[] = [];
  async record(event: ToolAuditEvent) { this.events.push(event); return ok(undefined); }
  async list() { return ok([...this.events]); }
}

class FakeCheckpoints implements AgentCheckpointRepository {
  constructor(public current: AgentCheckpoint | null) {}
  async get() { return ok(this.current); }
  async save() { return ok(undefined); }
  async listByThread() { return ok([]); }
  async delete() { return ok(undefined); }
}

const started: ToolAuditEvent = {
  toolId: "workspace.write", runId: "run-1", traceId: "run-1:2",
  status: "started", timestamp: 10
};

describe("ToolReconciliationService", () => {
  it("lists only started steps from failed or cancelled runs", async () => {
    const audit = new FakeAudit();
    audit.events = [
      started,
      { ...started, toolId: "workspace.read", traceId: "run-1:1", status: "completed", timestamp: 9 }
    ];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    expect(await service.listAmbiguous("run-1")).toEqual({
      ok: true,
      value: [{ toolId: "workspace.write", runId: "run-1", traceId: "run-1:2", startedAt: 10 }]
    });
  });


  it("surfaces failed steps with uncertain external outcomes but excludes pre-execution cancellation", async () => {
    const audit = new FakeAudit();
    audit.events = [
      started,
      { ...started, status: "failed", detail: "timeout", timestamp: 20 },
      { ...started, toolId: "workspace.read", traceId: "run-1:3", status: "started", timestamp: 25 },
      { ...started, toolId: "workspace.read", traceId: "run-1:3", status: "failed", detail: "Cancelled before execution.", timestamp: 30 }
    ];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("cancelled")));
    expect(await service.listAmbiguous("run-1")).toMatchObject({
      ok: true,
      value: [{ toolId: "workspace.write", runId: "run-1", traceId: "run-1:2", startedAt: 10 }]
    });
  });

  it("loads the complete bounded run history before identifying ambiguous steps", async () => {
    const audit = new FakeAudit();
    const list = vi.spyOn(audit, "list");
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    await service.listAmbiguous("run-1");
    expect(list).toHaveBeenCalledWith({ runId: "run-1", limit: 5_000 });
  });

  it("shows interrupted running tool evidence read-only while blocking reconciliation", async () => {
    const audit = new FakeAudit();
    audit.events = [started];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("running")));
    expect(await service.listAmbiguous("run-1")).toEqual({
      ok: true,
      value: [{ toolId: "workspace.write", runId: "run-1", traceId: "run-1:2", startedAt: 10 }]
    });
    expect(await service.reconcile("run-1", "workspace.write", "run-1:2", true))
      .toMatchObject({ ok: false, error: { code: "validation" } });
    expect(audit.events).toHaveLength(1);
    const successful = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("completed")));
    expect(await successful.listAmbiguous("run-1")).toEqual({ ok: true, value: [] });
  });

  it("requires owner confirmation and records a terminal state without replaying", async () => {
    const audit = new FakeAudit();
    audit.events = [started];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("cancelled")), () => 50);
    expect(await service.reconcile("run-1", "workspace.write", "run-1:2", false))
      .toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(await service.reconcile("run-1", "workspace.write", "run-1:2", true)).toEqual({ ok: true, value: undefined });
    expect(audit.events[audit.events.length - 1]).toMatchObject({
      status: "reconciled", timestamp: 50,
      detail: "Owner reviewed the external outcome. No tool retry was executed."
    });
    expect(await service.listAmbiguous("run-1")).toEqual({ ok: true, value: [] });
  });

  it("does not reconcile an already terminal or unknown step", async () => {
    const audit = new FakeAudit();
    audit.events = [started, { ...started, status: "completed", timestamp: 11 }];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    expect(await service.reconcile("run-1", "workspace.write", "run-1:2", true))
      .toMatchObject({ ok: false, error: { code: "validation" } });
    expect(audit.events).toHaveLength(2);
  });

  it("propagates audit history failures and rejects malformed identifiers", async () => {
    const audit: ToolAuditSink & { list: NonNullable<ToolAuditSink["list"]> } = {
      record: vi.fn(async () => ok(undefined)),
      list: vi.fn(async () => ({ ok: false as const, error: { code: "storage_failed" as const, message: "Unavailable", retryable: true } }))
    };
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    expect(await service.listAmbiguous("run-1")).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(await service.reconcile(" ", "workspace.write", "trace", true)).toMatchObject({ ok: false, error: { code: "validation" } });
  });
});


describe("cross-run audit isolation and complete-history reconciliation", () => {
  it("does not clear an ambiguous step when another run has the same tool/trace tuple", () => {
    const mixed: ToolAuditEvent[] = [
      started,
      { ...started, runId: "run-2", status: "completed", timestamp: 11 },
      { ...started, runId: "run-3", status: "reconciled", timestamp: 12 }
    ];
    expect(findAmbiguous(mixed)).toEqual([
      { toolId: "workspace.write", runId: "run-1", traceId: "run-1:2", startedAt: 10 }
    ]);
  });

  it("blocks manual reconciliation when the audit reader returns records from another run", async () => {
    const audit = new FakeAudit();
    audit.events = [
      started, { ...started, runId: "run-2", status: "completed", timestamp: 11 }
    ];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    expect(await service.listAmbiguous("run-1"))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(await service.reconcile("run-1", started.toolId, started.traceId, true))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(audit.events).toHaveLength(2);
  });

  it("rejects malformed audit receipts instead of treating them as no ambiguous work", async () => {
    const audit = new FakeAudit();
    audit.events = [{ ...started, timestamp: Number.NaN }];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    expect(await service.listAmbiguous("run-1"))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });

  it("never mistakes a late denial for proof that an already dispatched tool had no effect", async () => {
    const audit = new FakeAudit();
    audit.events = [
      started,
      { ...started, status: "denied", timestamp: 11,
        detail: "Later permission decision" }
    ];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    expect(await service.listAmbiguous("run-1")).toEqual({
      ok: true,
      value: [{ toolId: "workspace.write", runId: "run-1", traceId: "run-1:2", startedAt: 10 }]
    });
  });

  it("rejects a suspiciously full bounded history that could be truncated", async () => {
    const audit = new FakeAudit();
    audit.events = Array.from({ length: 5_000 }, (_, i) => ({
      ...started, traceId: "trace-" + i, timestamp: 10 + i
    }));
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("failed")));
    expect(await service.listAmbiguous("run-1"))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });
});
