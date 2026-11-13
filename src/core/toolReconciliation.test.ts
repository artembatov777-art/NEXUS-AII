import { describe, expect, it, vi } from "vitest";
import { ToolReconciliationService } from "./toolReconciliation";
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

  it("does not expose live or successful runs for reconciliation", async () => {
    const audit = new FakeAudit();
    audit.events = [started];
    const service = new ToolReconciliationService(audit, new FakeCheckpoints(checkpoint("running")));
    expect(await service.listAmbiguous("run-1")).toEqual({ ok: true, value: [] });
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
