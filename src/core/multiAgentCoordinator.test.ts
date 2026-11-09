import { describe, it, expect, vi } from "vitest";
import { MultiAgentCoordinator } from "./multiAgentCoordinator";
import { InMemoryTraceSink } from "./observability";
import { ok } from "./result";
import type { AgentId, AgentRunId } from "./agents";

const runId = "coord-run" as AgentRunId;
const plan = { goal: "work", steps: [{ id: "a", toolId: "x", purpose: "task", input: {}, dependsOn: [] }] };
const assignments = { a: "agent-a" as AgentId };
const collect = async (stream: AsyncIterable<{ type: string }>) => {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
};
const makeCoordinator = (execute: (agentId: AgentId, input: unknown, signal: AbortSignal) => Promise<ReturnType<typeof ok>>) =>
  new MultiAgentCoordinator({ execute }, { authorize: async () => "allow" }, new InMemoryTraceSink(), { now: () => 1 });

describe("MultiAgentCoordinator", () => {
  it("runs delegated steps in dependency order with explicit authorization", async () => {
    const execute = vi.fn(async (_id: AgentId, input: unknown) => ok({ input }));
    const policy = { authorize: vi.fn(async () => "allow" as const) };
    const coordinator = new MultiAgentCoordinator({ execute }, policy, new InMemoryTraceSink(), { now: () => 10 });
    const events = await collect(coordinator.run(runId, {
      goal: "work",
      steps: [
        { id: "a", toolId: "x", purpose: "first", input: { n: 1 }, dependsOn: [] },
        { id: "b", toolId: "y", purpose: "second", input: { n: 2 }, dependsOn: ["a"] }
      ]
    }, { a: "agent-a" as AgentId, b: "agent-b" as AgentId }, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(policy.authorize).toHaveBeenCalledTimes(2);
  });

  it("pauses for approval and resumes without replaying completed steps", async () => {
    let allowed = false;
    const execute = vi.fn(async () => ok({ done: true }));
    const coordinator = new MultiAgentCoordinator({ execute }, { authorize: async () => allowed ? "allow" : "ask_user" },
      new InMemoryTraceSink(), { now: () => 1 });
    const first = await collect(coordinator.run(runId, plan, assignments, new AbortController().signal));
    expect(first.at(-1)?.type).toBe("waiting_for_approval");
    expect(execute).not.toHaveBeenCalled();
    allowed = true;
    const resumed = await collect(coordinator.resume(runId, new AbortController().signal));
    expect(resumed.at(-1)?.type).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects forward dependencies before executing", async () => {
    const execute = vi.fn(async () => ok({}));
    const coordinator = makeCoordinator(execute);
    const invalid = { goal: "work", steps: [
      { id: "a", toolId: "x", purpose: "first", input: {}, dependsOn: ["b"] },
      { id: "b", toolId: "y", purpose: "second", input: {}, dependsOn: [] }
    ] };
    const events = await collect(coordinator.run(runId, invalid, { a: "agent-a" as AgentId, b: "agent-b" as AgentId }, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires an exact assignment for every step", async () => {
    const execute = vi.fn(async () => ok({}));
    const events = await collect(makeCoordinator(execute).run(runId, plan, {}, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects delegated outputs larger than 64 KB before sharing them with dependent agents", async () => {
    const execute = vi.fn(async () => ok({ content: "x".repeat(65_000) }));
    const coordinator = new MultiAgentCoordinator({ execute }, { authorize: async () => "allow" }, new InMemoryTraceSink(), { now: () => 1 });
    const twoSteps = { goal: "work", steps: [
      { id: "a", toolId: "x", purpose: "first", input: {}, dependsOn: [] },
      { id: "b", toolId: "y", purpose: "second", input: {}, dependsOn: ["a"] }
    ] };
    const events = await collect(coordinator.run(runId, twoSteps, { a: "agent-a" as AgentId, b: "agent-b" as AgentId }, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: "failed", detail: "Delegated output is not valid JSON or exceeds the 64 KB limit." });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects circular and non-JSON outputs", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const execute = vi.fn(async () => ok(circular));
    const events = await collect(makeCoordinator(execute).run(runId, plan, assignments, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("failed");
  });

  it("does not pass a result downstream when cancellation arrives during execution", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return ok({ secret: "must not propagate" });
    });
    const twoSteps = { goal: "work", steps: [
      { id: "a", toolId: "x", purpose: "first", input: {}, dependsOn: [] },
      { id: "b", toolId: "y", purpose: "second", input: {}, dependsOn: ["a"] }
    ] };
    const events = await collect(makeCoordinator(execute).run(runId, twoSteps,
      { a: "agent-a" as AgentId, b: "agent-b" as AgentId }, controller.signal));
    expect(events.at(-1)?.type).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("converts unexpected executor exceptions into a failed event", async () => {
    const execute = vi.fn(async () => { throw new Error("sensitive internal details"); });
    const events = await collect(makeCoordinator(execute).run(runId, plan, assignments, new AbortController().signal));
    expect(events.at(-1)).toMatchObject({ type: "failed", detail: "Delegated agent execution failed unexpectedly." });
  });
});
