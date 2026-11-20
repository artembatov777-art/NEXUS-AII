import { describe, expect, it, vi } from "vitest";
import { MultiAgentCoordinator, type CoordinationEvent } from "./multiAgentCoordinator";
import type { AgentId, AgentRunId } from "./agents";
import { InMemoryTraceSink } from "./observability";
import { ok } from "./result";

const id = "single-writer-run" as AgentRunId;
const agent = "tool-agent" as AgentId;
const plan = { goal: "inspect workspace", steps: [
  { id: "first", toolId: "test.read", purpose: "read", input: {}, dependsOn: [] }
] };
const assignments = { first: agent };
const signal = () => new AbortController().signal;
const collect = async (source: AsyncIterable<CoordinationEvent>) => {
  const events: CoordinationEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
};
function gate() {
  let open!: () => void;
  const waiting = new Promise<void>(resolve => { open = resolve; });
  return { waiting, open };
}
function coordinator(execute: (agentId: AgentId, input: unknown, signal: AbortSignal) => Promise<ReturnType<typeof ok>>) {
  return new MultiAgentCoordinator({ execute },
    { authorize: async () => "allow" }, new InMemoryTraceSink(), { now: () => 100 }, 12);
}

describe("Coordinator run-ID single-writer and replay protection", () => {
  it("rejects the same run ID while the first delegated tool is still executing", async () => {
    const executing = gate();
    const complete = gate();
    const execute = vi.fn(async () => {
      executing.open();
      await complete.waiting;
      return ok({ done: true });
    });
    const runtime = coordinator(execute);
    const first = collect(runtime.run(id, plan, assignments, signal()));
    await executing.waiting;

    const duplicate = await collect(runtime.run(id, plan, assignments, signal()));
    expect(duplicate).toEqual([expect.objectContaining({ type: "failed", runId: id })]);
    expect(execute).toHaveBeenCalledTimes(1);
    complete.open();
    expect((await first).at(-1)?.type).toBe("completed");
  });

  it("refuses to replay an already completed run, including in the same coordinator instance", async () => {
    const execute = vi.fn(async () => ok({ done: true }));
    const runtime = coordinator(execute);
    expect((await collect(runtime.run(id, plan, assignments, signal()))).at(-1)?.type).toBe("completed");
    expect((await collect(runtime.run(id, plan, assignments, signal()))).at(-1)?.type).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not accept a new run with an ID that already paused for approval", async () => {
    let allow = false;
    const execute = vi.fn(async () => ok({ done: true }));
    const runtime = new MultiAgentCoordinator({ execute },
      { authorize: async () => allow ? "allow" : "ask_user" },
      new InMemoryTraceSink(), { now: () => 100 }, 12);
    expect((await collect(runtime.run(id, plan, assignments, signal()))).at(-1)?.type).toBe("waiting_for_approval");
    expect((await collect(runtime.run(id, plan, assignments, signal()))).at(-1)?.type).toBe("failed");
    allow = true;
    expect((await collect(runtime.resume(id, signal()))).at(-1)?.type).toBe("completed");
    expect((await collect(runtime.run(id, plan, assignments, signal()))).at(-1)?.type).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("never delegates the same step twice when two approval continuations race", async () => {
    let allow = false;
    const executing = gate();
    const complete = gate();
    const execute = vi.fn(async () => {
      executing.open();
      await complete.waiting;
      return ok({ done: true });
    });
    const runtime = new MultiAgentCoordinator({ execute },
      { authorize: async () => allow ? "allow" : "ask_user" },
      new InMemoryTraceSink(), { now: () => 100 }, 12);
    await collect(runtime.run(id, plan, assignments, signal()));
    allow = true;
    const first = collect(runtime.resume(id, signal()));
    await executing.waiting;
    const duplicateResume = await collect(runtime.resume(id, signal()));
    const duplicateRun = await collect(runtime.run(id, plan, assignments, signal()));
    expect(duplicateResume.at(-1)?.type).toBe("failed");
    expect(duplicateRun.at(-1)?.type).toBe("failed");
    expect(execute).toHaveBeenCalledTimes(1);
    complete.open();
    expect((await first).at(-1)?.type).toBe("completed");
  });

  it("fails closed on invalid run IDs before any tool or permission is contacted", async () => {
    const execute = vi.fn(async () => ok({ done: true }));
    const authorize = vi.fn(async () => "allow" as const);
    const runtime = new MultiAgentCoordinator({ execute }, { authorize },
      new InMemoryTraceSink(), { now: () => 100 }, 12);
    for (const invalid of ["", "../danger", "illegal\u0000id", "x".repeat(121)]) {
      expect((await collect(runtime.run(invalid as AgentRunId, plan, assignments, signal()))).at(-1)?.type)
        .toBe("failed");
    }
    expect(execute).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does not accept new work when the safe lifetime run-ID capacity is exhausted", async () => {
    const execute = vi.fn(async () => ok({ done: true }));
    const runtime = coordinator(execute);
    // A bounded coordinator must not silently evict old run IDs, which could
    // make previously executed tool traces replayable under the same identity.
    for (let index = 0; index < 101; index++) {
      const events = await collect(runtime.run(("capacity-" + index) as AgentRunId, plan, assignments, signal()));
      expect(events.at(-1)?.type).toBe(index < 100 ? "completed" : "failed");
    }
    expect(execute).toHaveBeenCalledTimes(100);
  });
});
