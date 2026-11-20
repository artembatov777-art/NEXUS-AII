import { describe, expect, it, vi } from "vitest";
import { AgentCheckpointService, type AgentCheckpoint, type AgentCheckpointRepository } from "./agentCheckpoints";
import { PlanRunCheckpointService } from "./planRunCheckpoints";
import { ToolGateway } from "./tools";
import { ToolRegistry } from "./toolRegistry";
import { executeSequentialPlan } from "./planExecutor";
import type { AgentToolExecutor } from "./agentToolBridge";
import { ok, err } from "./result";

const plan = { goal: "inspect", steps: [
  { id: "one", toolId: "test.read", purpose: "Read one", input: { secret: "never-store-this" }, dependsOn: [] },
  { id: "two", toolId: "test.read", purpose: "Read two", input: {}, dependsOn: ["one"] }
] };

function setup(rejectSequence = -1) {
  const snapshots: AgentCheckpoint[] = [];
  const saved = new Map<string, AgentCheckpoint>();
  const repository: AgentCheckpointRepository = {
    get: async id => ok(saved.get(id) ?? null),
    save: async (checkpoint, expected) => {
      if (checkpoint.sequence === rejectSequence) return err("storage_failed", "Injected disk failure");
      if ((saved.get(checkpoint.runId)?.sequence ?? null) !== expected) {
        return err("storage_failed", "Checkpoint changed");
      }
      const snapshot = JSON.parse(JSON.stringify(checkpoint)) as AgentCheckpoint;
      saved.set(checkpoint.runId, snapshot);
      snapshots.push(snapshot);
      return ok(undefined);
    },
    listByThread: async () => ok([]),
    delete: async () => err("permission_denied", "No delete")
  };
  const recorder = new PlanRunCheckpointService(new AgentCheckpointService(repository), {
    agentId: "nexus.cli.plan", threadId: "cli-thread", now: () => 100
  });
  const gateway = new ToolGateway({ authorize: async () => "deny" }, {
    record: async () => ok(undefined), list: async () => ok([])
  }, { now: () => 100 });
  const registry = new ToolRegistry(gateway);
  expect(registry.register({ id: "test.read", version: "1", description: "Read",
    requiredPermissions: [], risk: "low", timeoutMs: 1000,
    validateInput: input => ok(input), execute: async input => ok(input) }).ok).toBe(true);
  const executed = vi.fn(async () => ok({ content: "read" }));
  const executor: AgentToolExecutor = {
    execute: async <Output = unknown>() => await executed() as ReturnType<typeof ok<Output>>
  };
  return { recorder, registry, executor, executed, saved, snapshots };
}

describe("checkpointed shared sequential plan execution", () => {
  it("writes dispatch intent before every side effect and confirms each result", async () => {
    const { recorder, registry, executor, executed, saved, snapshots } = setup();
    const result = await executeSequentialPlan(plan, "run-1", new AbortController().signal,
      registry, executor, undefined, recorder);
    expect(result.ok).toBe(true);
    expect(executed).toHaveBeenCalledTimes(2);
    expect(snapshots.map(cp => cp.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snapshots.map(cp => cp.status)).toEqual([
      "running", "running", "running", "running", "running", "completed"
    ]);
    expect((snapshots[1].state as {active: unknown}).active).toEqual({
      index: 0, id: "one", toolId: "test.read"
    });
    expect((snapshots[2].state as {active: unknown}).active).toBe(null);
    expect((snapshots[3].state as {active: unknown}).active).toEqual({
      index: 1, id: "two", toolId: "test.read"
    });
    expect(saved.get("run-1")?.status).toBe("completed");
    expect(JSON.stringify(snapshots)).not.toContain("never-store-this");
  });

  it("refuses to invoke any tool when dispatch-intent persistence fails", async () => {
    const { recorder, registry, executor, executed, saved } = setup(2);
    const result = await executeSequentialPlan(plan, "run-before-failed",
      new AbortController().signal, registry, executor, undefined, recorder);
    expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(executed).not.toHaveBeenCalled();
    expect(saved.get("run-before-failed")?.status).toBe("running");
  });

  it("stops after an ambiguous post-execution checkpoint failure instead of executing step two", async () => {
    const { recorder, registry, executor, executed, saved } = setup(3);
    const result = await executeSequentialPlan(plan, "run-after-failed",
      new AbortController().signal, registry, executor, undefined, recorder);
    expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(executed).toHaveBeenCalledTimes(1);
    expect((saved.get("run-after-failed")?.state as {active: unknown}).active).toMatchObject({
      index: 0, id: "one"
    });
  });

  it("records a cancelled in-flight step without presenting the run as completed", async () => {
    const controller = new AbortController();
    const { recorder, registry, saved } = setup();
    const executor: AgentToolExecutor = {
      execute: async <Output = unknown>() => {
        controller.abort();
        return ok({ effect: "might have happened" } as Output);
      }
    };
    const result = await executeSequentialPlan(plan, "run-cancelled",
      controller.signal, registry, executor, undefined, recorder);
    expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(saved.get("run-cancelled")?.status).toBe("cancelled");
    expect((saved.get("run-cancelled")?.state as {active: unknown}).active)
      .toMatchObject({ index: 0, id: "one" });
  });

  it("refuses to reuse a run ID before any tool can be repeated", async () => {
    const { recorder, registry, executor, executed } = setup();
    expect((await executeSequentialPlan(plan, "run-reuse", new AbortController().signal,
      registry, executor, undefined, recorder)).ok).toBe(true);
    const repeated = await executeSequentialPlan(plan, "run-reuse",
      new AbortController().signal, registry, executor, undefined, recorder);
    expect(repeated.ok).toBe(false);
    expect(executed).toHaveBeenCalledTimes(2);
  });
});
