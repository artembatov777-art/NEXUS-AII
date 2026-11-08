import { describe, expect, it, vi } from "vitest";
import { ok } from "../core/result";
import type { AgentId, AgentRunId } from "../core/agents";
import type { ResumableAgentDefinition } from "../core/resumableAgents";
import type { ToolExecutionContext } from "../core/tools";
import type { StorageLike } from "./memoryStorage";
import { createNexusRuntime, type NexusPermissionPolicy, type NexusRuntimeIds } from "./nexusRuntime";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const collect = async <T>(stream: AsyncIterable<T>): Promise<T[]> => {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const agentId = "composition-agent" as AgentId;
const runId = "composition-run" as AgentRunId;

const ids: NexusRuntimeIds = {
  runId: () => runId,
  approvalId: () => "composition-approval-once"
};

const toolContext = (context: ToolExecutionContext) => context;

describe("createNexusRuntime", () => {
  it("composes checkpoints, one-time approval, gateway execution and audit through one runtime", async () => {
    let agentDecision: "ask_user" | "allow" = "ask_user";
    const policy: NexusPermissionPolicy = {
      authorizeAgent: vi.fn(async () => agentDecision),
      authorizeTool: vi.fn(async request => request.scope === "memory:read" ? "allow" : "deny")
    };
    const runtime = createNexusRuntime({
      storage: new MemoryStorage(),
      actorId: "host-user",
      permissions: policy,
      ids,
      clock: { now: () => 10_000 }
    });

    expect(runtime.toolRegistry.search().ok).toBe(true);
    expect(runtime.mcpClient).toBeDefined();

    const execute = vi.fn(async (_input: { query: string }, context: ToolExecutionContext) => {
      expect(context.runId).toBe(runId);
      return ok({ answer: "NEXUS" });
    });
    expect(runtime.toolGateway.register({
      id: "memory.search",
      version: "1.0.0",
      description: "Search memory",
      requiredPermissions: ["memory:read"],
      risk: "low",
      timeoutMs: 2_000,
      validateInput: (input: unknown) =>
        input !== null && typeof input === "object" && "query" in input
          ? ok(input as { query: string })
          : { ok: false as const, error: { code: "validation" as const, message: "Query is required.", retryable: false } },
      execute
    }).ok).toBe(true);

    const definition: ResumableAgentDefinition<number> = {
      id: agentId,
      version: "1.0.0",
      name: "Composition test agent",
      requiredPermissions: ["tool:execute"],
      maxSteps: 3,
      timeoutMs: 5_000,
      createState: input => ({ count: input }),
      async step(state, context) {
        const result = await context.tools.execute<{ answer: string }>(
          "memory.search",
          { query: "NEXUS" },
          { runId: context.runId, step: context.step, signal: context.signal }
        );
        if (!result.ok) throw new Error(result.error.message);
        return {
          state: { ...(state as { count: number }), count: (state as { count: number }).count + 1 },
          done: true,
          output: result.value.answer
        };
      }
    };
    expect(runtime.agentRuntime.register(definition).ok).toBe(true);

    const waiting = await collect(runtime.agentRuntime.start(agentId, 0, "thread-composition"));
    expect(waiting).toEqual([{ type: "waiting_for_approval", runId, permission: "tool:execute" }]);

    const checkpoint = await runtime.checkpointService.get(runId);
    expect(checkpoint).toMatchObject({
      ok: true,
      value: { status: "waiting_for_approval", pendingApproval: { permission: "tool:execute" } }
    });

    const forged = await collect(runtime.agentRuntime.resume(runId, "forged"));
    expect(forged.at(-1)).toMatchObject({ type: "failed" });
    agentDecision = "allow";

    const grant = await runtime.issueApproval(runId);
    expect(grant.ok).toBe(true);
    if (!grant.ok) throw new Error("Expected explicit approval grant.");
    const completed = await collect(runtime.agentRuntime.resume(runId, grant.value));
    expect(completed.map(event => event.type)).toEqual(["started", "output", "completed"]);
    expect(completed.find(event => event.type === "output")).toMatchObject({ content: "NEXUS" });
    expect(execute).toHaveBeenCalledOnce();
    expect(policy.authorizeTool).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "host-user",
      scope: "memory:read",
      resource: "memory.search"
    }));

    const audit = await runtime.auditSink.list({ runId });
    expect(audit).toMatchObject({
      ok: true,
      value: [{ status: "started" }, { status: "completed" }]
    });
    const finalCheckpoint = await runtime.checkpointService.get(runId);
    expect(finalCheckpoint).toMatchObject({ ok: true, value: { status: "completed" } });

    const replay = await collect(runtime.agentRuntime.resume(runId, grant.value));
    expect(replay.at(-1)).toMatchObject({ type: "failed" });
  });

  it("uses default-deny permissions when no host policy is supplied", async () => {
    const runtime = createNexusRuntime({
      storage: new MemoryStorage(),
      actorId: "host-user",
      ids,
      clock: { now: () => 20_000 }
    });
    const registered = runtime.toolGateway.register({
      id: "restricted",
      version: "1",
      description: "Restricted tool",
      requiredPermissions: ["shell:execute"],
      risk: "high",
      timeoutMs: 1_000,
      validateInput: input => ok(input),
      execute: vi.fn(async () => ok("should-not-run"))
    });
    expect(registered.ok).toBe(true);
    const result = await runtime.toolGateway.execute(
      "restricted",
      {},
      toolContext({ runId, traceId: "trace", signal: new AbortController().signal }),
      "host-user"
    );
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  it("rejects invalid host identity before constructing a runtime", () => {
    expect(() => createNexusRuntime({ storage: new MemoryStorage(), actorId: " " })).toThrow(
      "A valid host actor identity is required."
    );
  });
});
