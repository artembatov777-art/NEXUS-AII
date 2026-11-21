import { describe, expect, it } from "vitest";
import { AgentCheckpointService } from "./agentCheckpoints";
import { LocalStorageAgentCheckpointRepository } from "../lib/agentCheckpointStorage";
import { PlanRunCheckpointService } from "./planRunCheckpoints";
import { ok } from "./result";

const plan = { goal: "inspect without secrets in checkpoint", steps: [
  { id: "read", toolId: "workspace.read", purpose: "Inspect", input: { token: "never-persist-this" }, dependsOn: [] },
  { id: "search", toolId: "workspace.search", purpose: "Find", input: { pattern: "private pattern" }, dependsOn: ["read"] }
] };

class Store {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function setup() {
  const storage = new Store();
  const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(storage));
  const tracker = new PlanRunCheckpointService(service, {
    agentId: "nexus.cli.plan", threadId: "workspace-cli", now: () => 100
  });
  return { tracker, service, storage };
}

describe("shared plan run checkpoints", () => {
  it("persists a bounded plan metadata snapshot before and after each dispatch", async () => {
    const { tracker, service, storage } = setup();
    const created = await tracker.begin("plan-1", plan);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const session = created.value;
    expect(await session.beforeStep(0, "read", "workspace.read")).toEqual(ok(undefined));
    const during = await service.get("plan-1");
    expect(during.ok && during.value?.status).toBe("running");
    expect(during.ok && (during.value?.state as {active?:unknown})?.active).toEqual({
      index: 0, id: "read", toolId: "workspace.read"
    });
    expect(await session.afterStep(0)).toEqual(ok(undefined));
    expect(await session.beforeStep(1, "search", "workspace.search")).toEqual(ok(undefined));
    expect(await session.afterStep(1)).toEqual(ok(undefined));
    expect(await session.complete()).toEqual(ok(undefined));
    const finished = await service.get("plan-1");
    expect(finished.ok && finished.value?.status).toBe("completed");
    expect(finished.ok && finished.value?.sequence).toBe(6);
    expect(finished.ok && (finished.value?.state as {nextStep?:unknown})?.nextStep).toBe(2);
    const raw = [...storage.values.values()].join("");
    expect(raw).not.toContain("never-persist-this");
    expect(raw).not.toContain("private pattern");
    expect(raw).not.toContain("inspect without secrets");
    expect(raw).toContain("workspace.read");
  });

  it("binds exactly one child run to each active step before recording completion", async () => {
    const { tracker, service } = setup();
    const begun = await tracker.begin("parent-run", plan);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect((await begun.value.bindChildRun(0, "child-1")).ok).toBe(false);
    expect((await begun.value.beforeStep(0, "read", "workspace.read")).ok).toBe(true);
    expect((await begun.value.bindChildRun(1, "child-1")).ok).toBe(false);
    expect((await begun.value.bindChildRun(0, "parent-run")).ok).toBe(false);
    expect((await begun.value.bindChildRun(0, "../unsafe")).ok).toBe(false);
    expect((await begun.value.bindChildRun(0, "child-1")).ok).toBe(true);
    expect((await begun.value.bindChildRun(0, "other-child")).ok).toBe(false);
    expect((await begun.value.afterStep(0)).ok).toBe(true);
    expect((await begun.value.beforeStep(1, "search", "workspace.search")).ok).toBe(true);
    expect((await begun.value.bindChildRun(1, "child-1")).ok).toBe(false);
    expect((await begun.value.bindChildRun(1, "child-2")).ok).toBe(true);
    expect((await begun.value.interrupt("failed")).ok).toBe(true);
    expect(await service.get("parent-run")).toMatchObject({
      ok: true, value: { status: "failed", state: {
        childRuns: [{ index: 0, runId: "child-1" }, { index: 1, runId: "child-2" }],
        nextStep: 1, active: { index: 1 }
      }}
    });
  });

  it("never lets a second session claim an existing run or skip a dispatch", async () => {
    const { tracker } = setup();
    const first = await tracker.begin("same-run", plan);
    expect(first.ok).toBe(true);
    expect((await tracker.begin("same-run", plan)).ok).toBe(false);
    if (!first.ok) return;
    expect((await first.value.beforeStep(1, "search", "workspace.search")).ok).toBe(false);
    expect((await first.value.beforeStep(0, "wrong", "workspace.read")).ok).toBe(false);
    expect((await first.value.afterStep(0)).ok).toBe(false);
    expect((await first.value.complete()).ok).toBe(false);
    expect((await first.value.beforeStep(0, "read", "workspace.read")).ok).toBe(true);
    expect((await first.value.beforeStep(0, "read", "workspace.read")).ok).toBe(false);
  });

  it("retains active-step ambiguity on failure and forbids state mutation after terminal", async () => {
    const { tracker, service } = setup();
    const started = await tracker.begin("failed-run", plan);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect((await started.value.beforeStep(0, "read", "workspace.read")).ok).toBe(true);
    expect((await started.value.interrupt("failed")).ok).toBe(true);
    const saved = await service.get("failed-run");
    expect(saved.ok && saved.value?.status).toBe("failed");
    expect(saved.ok && (saved.value?.state as {active?:unknown})?.active).toMatchObject({
      index: 0, id: "read"
    });
    expect((await started.value.afterStep(0)).ok).toBe(false);
    expect((await started.value.complete()).ok).toBe(false);
  });

  it("does not dispatch after a checkpoint persistence failure", async () => {
    const { tracker } = setup();
    const started = await tracker.begin("interrupted", plan);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const invalidIndex = await started.value.beforeStep(0, "search", "workspace.search");
    expect(invalidIndex).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("rejects a checkpoint run without a valid plan or identifier", async () => {
    const { tracker } = setup();
    expect((await tracker.begin("../escape", plan)).ok).toBe(false);
    expect((await tracker.begin("okay", { goal: "", steps: [] })).ok).toBe(false);
  });
});
