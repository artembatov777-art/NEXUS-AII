import { describe, expect, it, vi } from "vitest";
import { AgentCheckpointService, type JsonValue } from "./agentCheckpoints";
import { ResumableAgentRuntime, type ResumableAgentDefinition } from "./resumableAgents";
import type { AgentId, AgentRunId } from "./agents";
import { LocalStorageAgentCheckpointRepository } from "../lib/agentCheckpointStorage";
import type { StorageLike } from "../lib/memoryStorage";
import { GatewayAgentToolExecutor } from "./agentToolBridge";
import { ToolGateway } from "./tools";
import { ok } from "./result";

class FakeStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const collect = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
};
const agentId = "step-agent" as AgentId;
const runId = "resume-1" as AgentRunId;
const makeDefinition = (): ResumableAgentDefinition<number> => ({
  id: agentId, version: "1.0.0", name: "Step agent", requiredPermissions: [],
  maxSteps: 5, timeoutMs: 5_000, createState: input => ({ count: input }),
  async step(state: JsonValue) {
    const count = Number((state as { count: number }).count) + 1;
    return { state: { count }, done: count >= 2, progress: `step ${count}`, output: String(count) };
  }
});
const makeRuntime = (service: AgentCheckpointService) => {
  const runtime = new ResumableAgentRuntime(service,
    { authorize: vi.fn().mockResolvedValue("allow") },
    { runId: () => runId },
    { now: () => 1_000 });
  runtime.register(makeDefinition());
  return runtime;
};

describe("ResumableAgentRuntime", () => {
  it("continues after a consumer/process interruption without replaying completed steps", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    const firstRuntime = makeRuntime(service);
    const firstEvents: string[] = [];
    for await (const event of firstRuntime.start(agentId, 0, "thread-1")) {
      firstEvents.push(event.type);
      if (event.type === "progress") break;
    }
    expect(firstEvents).toContain("progress");
    const saved = await service.get(runId);
    expect(saved.ok && (saved.value?.state as { payload: { count: number } }).payload.count).toBe(1);
    expect(saved.ok && saved.value?.status).toBe("running");

    // A new runtime instance models a fresh app process after restart.
    const restartedRuntime = makeRuntime(service);
    const resumed = await collect(restartedRuntime.continue(runId));
    expect(resumed.map(event => event.type)).toEqual(["started", "progress", "output", "completed"]);
    const final = await service.get(runId);
    expect(final.ok && final.value?.status).toBe("completed");
    expect(final.ok && (final.value?.state as { payload: { count: number } }).payload.count).toBe(2);
  });

  it("requires an explicit matching approval before resuming a waiting run", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    const permission = "tool:execute" as const;
    let decision: "ask_user" | "allow" = "ask_user";
    const runtime = new ResumableAgentRuntime(service,
      { authorize: vi.fn().mockImplementation(async () => decision) },
      { runId: () => runId }, { now: () => 2_000 });
    runtime.register({ ...makeDefinition(), requiredPermissions: [permission] });
    const started = await collect(runtime.start(agentId, 0, "thread-approval"));
    expect(started).toEqual([{ type: "waiting_for_approval", runId, permission }]);
    const wrongApproval = await collect(runtime.resume(runId, "conversation:read"));
    expect(wrongApproval.at(-1)).toMatchObject({ type: "failed" });
    decision = "allow";
    const resumed = await collect(runtime.resume(runId, permission));
    expect(resumed.at(-1)).toMatchObject({ type: "completed" });
  });

  it("executes agent tool calls through the host-bound gateway and records audit events", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    const agentPermissions = { authorize: vi.fn().mockResolvedValue("allow") };
    const toolPermissions = { authorize: vi.fn().mockResolvedValue("allow") };
    const audit = { record: vi.fn().mockResolvedValue(ok(undefined)) };
    const gateway = new ToolGateway(toolPermissions, audit, { now: () => 3_000 });
    const toolExecute = vi.fn().mockResolvedValue(ok({ note: "found" }));
    gateway.register({
      id: "notes.search", version: "1", description: "Search local notes",
      requiredPermissions: ["memory:read"], risk: "low", timeoutMs: 1_000,
      validateInput: (input: unknown) => input !== null && typeof input === "object" && "query" in input
        ? ok(input as { query: string })
        : { ok: false as const, error: { code: "validation" as const, message: "Invalid input", retryable: false } },
      execute: toolExecute
    });
    const executor = new GatewayAgentToolExecutor(gateway, "host-user");
    const runtime = new ResumableAgentRuntime(
      service, agentPermissions, { runId: () => runId }, { now: () => 3_000 }, executor
    );
    runtime.register({
      ...makeDefinition(),
      async step(state, context) {
        const result = await context.tools.execute<{ note: string }>("notes.search", { query: "NEXUS" }, {
          runId: context.runId, step: context.step, signal: context.signal
        });
        if (!result.ok) throw new Error(result.error.message);
        return { state, done: true, output: result.value.note };
      }
    });
    const events = await collect(runtime.start(agentId, 0, "thread-tools"));
    expect(events.map(event => event.type)).toEqual(["started", "output", "completed"]);
    expect(events.find(event => event.type === "output")).toMatchObject({ content: "found" });
    expect(agentPermissions.authorize).not.toHaveBeenCalled();
    expect(toolPermissions.authorize).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "host-user", scope: "memory:read", resource: "notes.search"
    }));
    expect(toolExecute).toHaveBeenCalledOnce();
    expect(audit.record.mock.calls.map(call => call[0].status)).toEqual(["started", "completed"]);
  });

  it("rejects a second concurrent continuation through checkpoint compare-and-swap", async () => {
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(new FakeStorage()));
    const runtime = makeRuntime(service);
    const iterator = runtime.start(agentId, 0, "thread-race")[Symbol.asyncIterator]();
    await iterator.next(); // outer started event
    await iterator.next(); // inner started event
    await iterator.next(); // first progress, with state already persisted
    await iterator.return?.();
    const first = makeRuntime(service);
    const second = makeRuntime(service);
    const results = await Promise.all([
      collect(first.continue(runId)),
      collect(second.continue(runId))
    ]);
    expect(results.flat().filter(event => event.type === "completed")).toHaveLength(1);
  });
});
