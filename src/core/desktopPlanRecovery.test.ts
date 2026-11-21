import { describe, expect, it, vi } from "vitest";
import type { AgentCheckpoint } from "./agentCheckpoints";
import { inspectDesktopPlanRecovery } from "./desktopPlanRecovery";
import { ok, err } from "./result";
import type { ToolAuditEvent } from "./tools";

const parentId = "coord_parent";
const threadId = "owner-thread";
const parent = (status: AgentCheckpoint["status"] = "completed"): AgentCheckpoint => ({
  schemaVersion: 1, runId: parentId, threadId, agentId: "nexus.desktop.workflow",
  sequence: 5, status, createdAt: 100, updatedAt: 400,
  state: { kind: "nexus.plan-run.v1", steps: [{ id: "read", toolId: "notes.read" }],
    nextStep: status === "completed" ? 1 : 0,
    active: status === "completed" ? null : { index: 0, id: "read", toolId: "notes.read" },
    childRuns: [{ index: 0, runId: "child-1" }] }
});
const child = (): AgentCheckpoint => ({
  schemaVersion: 1, runId: "child-1", threadId, agentId: "nexus.tool-invocation",
  sequence: 2, status: "completed", createdAt: 200, updatedAt: 300,
  state: { payload: { toolId: "notes.read", input: { secret: "not-for-diagnostics" }, purpose: "read" },
    permissionIndex: 1, agentVersion: "1.0.0", steps: 1,
    delegation: { parentCheckpointId: parentId, stepIndex: 0 } }
});
const started: ToolAuditEvent = {
  runId: "child-1", traceId: "child-1:1", toolId: "notes.read", timestamp: 210, status: "started"
};
const completed: ToolAuditEvent = { ...started, status: "completed", timestamp: 290 };
function setup(p = parent(), c: AgentCheckpoint | null = child(), events = [started, completed]) {
  const repository = { get: vi.fn(async (id: string) => ok<AgentCheckpoint | null>(
    id === parentId ? p : id === "child-1" ? c : null)) };
  const audit = { list: vi.fn(async (_options?: { runId?: string; limit?: number }) => ok(events)) };
  return { repository, audit, inspect: () => inspectDesktopPlanRecovery(parentId, threadId, repository, audit) };
}
describe("Desktop parent-child recovery evidence", () => {
  it("correlates reciprocal identities and complete tool receipts without exposing tool inputs", async () => {
    const { inspect, audit } = setup();
    const result = await inspect();
    expect(result).toMatchObject({ ok: true, value: {
      parentCheckpointId: parentId, confirmedSteps: 1, totalSteps: 1,
      requiresOwnerReview: false, mayAutoResume: false,
      steps: [{ index: 0, toolId: "notes.read", childRunId: "child-1",
        childStatus: "completed", evidence: "confirmed", auditEvents: 2 }]
    }});
    expect(JSON.stringify(result)).not.toContain("not-for-diagnostics");
    expect(audit.list).toHaveBeenCalledWith({ runId: "child-1", limit: 5000 });
  });
  it("treats legacy unlinked steps as unknown, without searching unrelated runs", async () => {
    const p = parent();
    p.state = { kind: "nexus.plan-run.v1", steps: [{ id: "read", toolId: "notes.read" }], nextStep: 1, active: null };
    const { inspect, audit } = setup(p);
    expect(await inspect()).toMatchObject({ ok: true, value: {
      requiresOwnerReview: true, mayAutoResume: false, steps: [{ evidence: "unlinked" }]
    }});
    expect(audit.list).not.toHaveBeenCalled();
  });
  it("reports a reserved ID without a child checkpoint as unverified, not a safe retry", async () => {
    const { inspect, audit } = setup(parent("failed"), null);
    expect(await inspect()).toMatchObject({ ok: true, value: {
      requiresOwnerReview: true, mayAutoResume: false,
      steps: [{ childRunId: "child-1", evidence: "missing_checkpoint" }]
    }});
    expect(audit.list).not.toHaveBeenCalled();
  });
  it("does not trust a child from another thread or a different parent", async () => {
    const wrong = child();
    wrong.threadId = "other-thread";
    const { inspect, repository, audit } = setup(parent(), wrong);
    expect(await inspect()).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(audit.list).not.toHaveBeenCalled();
    const forged = child();
    (forged.state as { delegation: { parentCheckpointId: string } }).delegation.parentCheckpointId = "coord_other";
    repository.get.mockImplementation(async id => ok(id === parentId ? parent() : forged));
    expect(await inspect()).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(audit.list).not.toHaveBeenCalled();
  });
  it("treats incomplete, denied or failed audit as unresolved even if the parent says completed", async () => {
    for (const events of [[], [started], [completed], [completed, started],
      [started, completed, completed], [started, { ...completed, timestamp: 100 }],
      [started, { ...completed, status: "failed" as const }]]) {
      const { inspect } = setup(parent(), child(), events);
      expect(await inspect()).toMatchObject({ ok: true, value: {
        requiresOwnerReview: true, mayAutoResume: false, steps: [{ evidence: "uncertain" }]
      }});
    }
  });
  it("rejects malformed links, mixed tool receipts and unavailable history", async () => {
    const p = parent();
    (p.state as { childRuns: unknown[] }).childRuns = [{ index: 0, runId: "child-1" }, { index: 0, runId: "child-2" }];
    const invalid = setup(p);
    expect(await invalid.inspect()).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(invalid.audit.list).not.toHaveBeenCalled();
    const mixed = setup(parent(), child(), [started, { ...completed, toolId: "unrelated.tool" }]);
    expect(await mixed.inspect()).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    const unavailable = setup();
    unavailable.audit.list.mockResolvedValue(err("storage_failed", "unavailable"));
    expect(await unavailable.inspect()).toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });
  it("never marks an interrupted parent as completed even with completed child receipts", async () => {
    const { inspect } = setup(parent("running"));
    expect(await inspect()).toMatchObject({ ok: true, value: {
      status: "running", requiresOwnerReview: true, mayAutoResume: false,
      steps: [{ evidence: "confirmed" }]
    }});
  });
});
