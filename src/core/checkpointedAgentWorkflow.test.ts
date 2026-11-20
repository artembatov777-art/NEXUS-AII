import { describe, expect, it, vi } from "vitest";
import { AgentCheckpointService, type AgentCheckpoint, type AgentCheckpointRepository } from "./agentCheckpoints";
import { PlanRunCheckpointService } from "./planRunCheckpoints";
import { createAgentWorkflow } from "./agentWorkflow";
import { AgentPlanner } from "./agentPlanner";
import { MultiAgentCoordinator } from "./multiAgentCoordinator";
import { ToolGateway } from "./tools";
import { ToolRegistry } from "./toolRegistry";
import { ok, err } from "./result";
import type { AgentId, AgentRunId } from "./agents";

function setup(rejectSequence = -1) {
  const records = new Map<string, AgentCheckpoint>();
  const history: AgentCheckpoint[] = [];
  const repository: AgentCheckpointRepository = {
    get: async id => ok(records.get(id) ?? null),
    save: async (checkpoint, expected) => {
      if (checkpoint.sequence === rejectSequence) return err("storage_failed", "Injected checkpoint failure");
      if ((records.get(checkpoint.runId)?.sequence ?? null) !== expected) {
        return err("storage_failed", "Concurrent checkpoint writer");
      }
      const snapshot = JSON.parse(JSON.stringify(checkpoint)) as AgentCheckpoint;
      records.set(checkpoint.runId, snapshot);
      history.push(snapshot);
      return ok(undefined);
    },
    listByThread: async () => ok([]),
    delete: async () => err("permission_denied", "No deletion")
  };
  const checkpoints = new AgentCheckpointService(repository);
  const recorder = new PlanRunCheckpointService(checkpoints, {
    agentId: "nexus.desktop.workflow", threadId: "desktop-thread", now: () => 100
  });
  const gateway = new ToolGateway({ authorize: async () => "deny" }, {
    record: async () => ok(undefined), list: async () => ok([])
  }, { now: () => 100 });
  const registry = new ToolRegistry(gateway);
  registry.register({ id: "safe.read", version: "1", description: "Read",
    requiredPermissions: [], risk: "low", timeoutMs: 1_000,
    validateInput: input => ok(input), execute: async input => ok(input) });
  const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [
    { id: "one", toolId: "safe.read", purpose: "Inspect file", input: { path: "first" }, dependsOn: [] }
  ] }) });
  let decision: "allow" | "ask_user" = "allow";
  const execute = vi.fn(async () => ok({ content: "read" }));
  const coordinator = new MultiAgentCoordinator({ execute },
    { authorize: async () => decision },
    { append: async () => ok(undefined), list: async () => ok([]) }, { now: () => 100 }, 12);
  const workflow = createAgentWorkflow(planner, registry, coordinator,
    "tool-agent" as AgentId, ["safe.read"], recorder);
  const id = "workflow-1" as AgentRunId;
  const collect = async (stream: AsyncIterable<{ type: string }>) => {
    const results: Array<{ type: string }> = [];
    for await (const event of stream) results.push(event);
    return results;
  };
  return { workflow, id, records, history, execute, collect, setDecision: (next: "allow" | "ask_user") => { decision = next; } };
}

describe("Desktop host shares durable run checkpoints with CLI plan execution", () => {
  it("records each dispatch before delegation and completes only after a confirmed result", async () => {
    const { workflow, id, records, history, execute, collect } = setup();
    const plan = await workflow.plan("inspect", new AbortController().signal);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const events = await collect(workflow.run(plan.value, id, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(history.map(item => item.sequence)).toEqual([1, 2, 3, 4]);
    expect(history.map(item => item.status)).toEqual(["running", "running", "running", "completed"]);
    expect((history[1].state as {active: unknown}).active).toMatchObject({
      index: 0, id: "one", toolId: "safe.read"
    });
    expect(records.get(id)?.status).toBe("completed");
  });

  it("saves owner approval pauses, then resumes without replaying steps", async () => {
    const { workflow, id, records, execute, collect, setDecision } = setup();
    const plan = await workflow.plan("inspect", new AbortController().signal);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    setDecision("ask_user");
    const paused = await collect(workflow.run(plan.value, id, new AbortController().signal));
    expect(paused.at(-1)?.type).toBe("waiting_for_approval");
    expect(records.get(id)?.status).toBe("waiting_for_approval");
    expect(execute).not.toHaveBeenCalled();
    setDecision("allow");
    const resumed = await collect(workflow.resume(id, new AbortController().signal));
    expect(resumed.at(-1)?.type).toBe("completed");
    expect(records.get(id)?.status).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses dispatch if checkpoint persistence fails before the step", async () => {
    const { workflow, id, records, execute, collect } = setup(2);
    const plan = await workflow.plan("inspect", new AbortController().signal);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const events = await collect(workflow.run(plan.value, id, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
    expect(records.get(id)?.sequence).toBe(1);
  });

  it("stops after an executed step whose completion checkpoint could not be saved", async () => {
    const { workflow, id, records, execute, collect } = setup(3);
    const plan = await workflow.plan("inspect", new AbortController().signal);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const events = await collect(workflow.run(plan.value, id, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(records.get(id)?.status).toBe("running");
    expect((records.get(id)?.state as {active: unknown}).active)
      .toMatchObject({ index: 0, id: "one" });
  });

  it("does not invent a recovery path when a paused coordinator was lost", async () => {
    const { workflow, id, execute, collect } = setup();
    const events = await collect(workflow.resume(id, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });
});
