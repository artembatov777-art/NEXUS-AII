import { describe, expect, it, vi } from "vitest";
import { AgentRuntime, type AgentDefinition, type AgentId, type AgentRunId } from "./agents";

const agentId = "assistant" as AgentId;
const makeRuntime = (decision: "allow" | "deny" | "ask_user" = "allow") => {
  const permissions = { authorize: vi.fn().mockResolvedValue(decision) };
  let sequence = 0;
  const runtime = new AgentRuntime(
    permissions,
    { runId: () => `run-${++sequence}` as AgentRunId },
    { now: () => 1_000 }
  );
  return { runtime, permissions };
};

const definition = (overrides: Partial<AgentDefinition<string>> = {}): AgentDefinition<string> => ({
  id: agentId,
  version: "1.0.0",
  name: "Assistant",
  description: "A bounded test agent",
  requiredPermissions: ["conversation:read"],
  maxSteps: 3,
  timeoutMs: 5_000,
  async *execute(input, context) {
    context.checkpoint("prepare");
    yield { type: "progress", label: "prepare" };
    yield { type: "output", content: input };
  },
  ...overrides
});

const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
};

describe("AgentRuntime", () => {
  it("registers and lists agent metadata without exposing implementation", () => {
    const { runtime } = makeRuntime();
    expect(runtime.register(definition()).ok).toBe(true);
    expect(runtime.list()).toEqual([{
      id: agentId,
      version: "1.0.0",
      name: "Assistant",
      description: "A bounded test agent",
      requiredPermissions: ["conversation:read"],
      maxSteps: 3,
      timeoutMs: 5_000
    }]);
    expect(runtime.register(definition()).ok).toBe(false);
  });

  it("runs an approved agent and emits lifecycle events", async () => {
    const { runtime, permissions } = makeRuntime();
    runtime.register(definition());
    const events = await collect(runtime.run(agentId, "hello"));
    expect(permissions.authorize).toHaveBeenCalledOnce();
    expect(events.map(event => event.type)).toEqual(["started", "progress", "output", "completed"]);
    expect(events.at(-1)).toMatchObject({ type: "completed", steps: 1 });
  });

  it("fails closed when permission is denied", async () => {
    const { runtime, permissions } = makeRuntime("deny");
    runtime.register(definition());
    const events = await collect(runtime.run(agentId, "hello"));
    expect(permissions.authorize).toHaveBeenCalledOnce();
    expect(events.map(event => event.type)).toEqual(["failed"]);
    expect(events[0]).toMatchObject({ code: "permission_denied" });
  });

  it("surfaces approval handoff but does not continue without approval", async () => {
    const { runtime } = makeRuntime("ask_user");
    runtime.register(definition());
    const events = await collect(runtime.run(agentId, "hello"));
    expect(events.map(event => event.type)).toEqual(["waiting_for_approval", "failed"]);
  });

  it("rejects invalid execution budgets", () => {
    const { runtime } = makeRuntime();
    expect(runtime.register(definition({ maxSteps: 0 })).ok).toBe(false);
    expect(runtime.register(definition({ timeoutMs: 500 })).ok).toBe(false);
  });

  it("stops when the step budget is exhausted", async () => {
    const { runtime } = makeRuntime();
    runtime.register(definition({
      maxSteps: 1,
      async *execute(_input, context) {
        context.checkpoint("one");
        yield { type: "progress", label: "one" };
        context.checkpoint("two");
      }
    }));
    const events = await collect(runtime.run(agentId, "hello"));
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "validation" });
  });

  it("does not start a pre-cancelled run", async () => {
    const { runtime, permissions } = makeRuntime();
    runtime.register(definition());
    const controller = new AbortController();
    controller.abort();
    const events = await collect(runtime.run(agentId, "hello", controller.signal));
    expect(permissions.authorize).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ type: "failed", code: "cancelled" });
  });

  it("limits oversized agent output", async () => {
    const { runtime } = makeRuntime();
    runtime.register(definition({
      async *execute() {
        yield { type: "output", content: "x".repeat(20_001) };
      }
    }));
    const events = await collect(runtime.run(agentId, "hello"));
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "validation" });
  });
});
