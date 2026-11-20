import { describe, expect, it, vi } from "vitest";
import { inspectPlanRecovery } from "./planRecoveryInspection";
import type { AgentCheckpoint } from "./agentCheckpoints";
import type { ToolAuditEvent } from "./tools";
import { ok, err } from "./result";

const checkpoint = (status: AgentCheckpoint["status"] = "failed"): AgentCheckpoint => ({
  schemaVersion: 1,
  runId: "run-1",
  agentId: "nexus.cli.workspace",
  threadId: "workspace-cli",
  sequence: 3,
  status,
  state: {
    kind: "nexus.plan-run.v1",
    steps: [
      { id: "first", toolId: "cli.workspace.read" },
      { id: "second", toolId: "cli.workspace.search" }
    ],
    nextStep: 1,
    active: { index: 1, id: "second", toolId: "cli.workspace.search" }
  },
  createdAt: 100,
  updatedAt: 200
});
const started: ToolAuditEvent = {
  runId: "run-1", toolId: "cli.workspace.search", traceId: "run-1:2",
  status: "started", timestamp: 110
};
function setup(cp: AgentCheckpoint | null = checkpoint(), events: ToolAuditEvent[] = [started]) {
  const repository = { get: vi.fn(async (_id: string) => ok<AgentCheckpoint | null>(cp)) };
  const audit = { list: vi.fn(async (_options?: { runId?: string; limit?: number }) =>
    ok<ToolAuditEvent[]>(events)) };
  return { repository, audit };
}
const options = { agentId: "nexus.cli.workspace", threadId: "workspace-cli" };

describe("combined read-only plan recovery inspection", () => {
  it("correlates the last confirmed step with an ambiguous external dispatch", async () => {
    const { repository, audit } = setup();
    const report = await inspectPlanRecovery("run-1", repository, audit, options);
    expect(report).toMatchObject({ ok: true, value: {
      runId: "run-1", status: "failed", confirmedSteps: 1, totalSteps: 2,
      inFlight: { index: 1, id: "second", toolId: "cli.workspace.search" },
      ambiguous: [{ runId: "run-1", traceId: "run-1:2", toolId: "cli.workspace.search" }],
      requiresOwnerReview: true, mayAutoResume: false
    } });
    expect(repository.get).toHaveBeenCalledWith("run-1");
    expect(audit.list).toHaveBeenCalledWith({ runId: "run-1", limit: 5_000 });
  });

  it("does not mistake an absent audit record for proof that an active tool did nothing", async () => {
    const { repository, audit } = setup(checkpoint("running"), []);
    const report = await inspectPlanRecovery("run-1", repository, audit, options);
    expect(report).toMatchObject({ ok: true, value: {
      status: "running", inFlight: { index: 1 }, requiresOwnerReview: true, mayAutoResume: false,
      ambiguous: []
    } });
  });

  it("shows a completed plan as finished without ever permitting automatic replay", async () => {
    const done = checkpoint("completed");
    done.state = { kind: "nexus.plan-run.v1",
      steps: [{ id: "first", toolId: "cli.workspace.read" }, { id: "second", toolId: "cli.workspace.search" }],
      nextStep: 2, active: null };
    const { repository, audit } = setup(done, [{ ...started, status: "completed", timestamp: 111 }]);
    const report = await inspectPlanRecovery("run-1", repository, audit, options);
    expect(report).toMatchObject({ ok: true, value: {
      status: "completed", confirmedSteps: 2, inFlight: null,
      requiresOwnerReview: false, mayAutoResume: false
    } });
  });

  it("rejects forged run identity or a different owner's agent without returning metadata", async () => {
    const { repository, audit } = setup({ ...checkpoint(), threadId: "not-this-workspace" });
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(audit.list).not.toHaveBeenCalled();
    repository.get.mockResolvedValue(ok({ ...checkpoint(), runId: "another-run" }));
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });

  it("fails closed for corrupted plan state and mixed-run audit evidence", async () => {
    const malformed = checkpoint();
    malformed.state = { kind: "nexus.plan-run.v1",
      steps: [{ id: "first", toolId: "cli.workspace.read" }], nextStep: 9, active: null };
    const { repository, audit } = setup(malformed);
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
    repository.get.mockResolvedValue(ok(checkpoint()));
    audit.list.mockResolvedValue(ok([started, { ...started, runId: "another-run", status: "completed" }]));
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });

  it("blocks incomplete history, missing checkpoint, storage errors and invalid IDs", async () => {
    const { repository, audit } = setup();
    audit.list.mockResolvedValue(ok(Array.from({ length: 5_000 }, (_, i) =>
      ({ ...started, traceId: "trace-" + i }))));
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
    repository.get.mockResolvedValue(ok(null));
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "validation" } });
    expect(await inspectPlanRecovery("../danger", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "validation" } });
    repository.get.mockRejectedValue(new Error("unavailable"));
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
    repository.get.mockResolvedValue(err("storage_failed", "unavailable"));
    expect(await inspectPlanRecovery("run-1", repository, audit, options))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });
});
