import { describe, expect, it, vi } from "vitest";
import { ok } from "../core/result";
import type { AgentId, AgentRunId } from "../core/agents";
import type { ResumableAgentDefinition } from "../core/resumableAgents";
import type { ToolExecutionContext } from "../core/tools";
import { ModelRouter } from "../core/model";
import type { ModelProvider } from "../core/model";
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
const ids: NexusRuntimeIds = { runId: () => runId, approvalId: () => "composition-approval-once" };
const toolContext = (context: ToolExecutionContext) => context;

describe("createNexusRuntime", () => {
  it("composes checkpoints, one-time approval, gateway execution and audit through one runtime", async () => {
    let agentDecision: "ask_user" | "allow" = "ask_user";
    const policy: NexusPermissionPolicy = {
      authorizeAgent: vi.fn(async () => agentDecision),
      authorizeTool: vi.fn(async request => request.scope === "memory:read" ? "allow" : "deny")
    };
    const runtime = createNexusRuntime({ storage: new MemoryStorage(), actorId: "host-user", permissions: policy, ids, clock: { now: () => 10_000 } });
    expect(runtime.toolRegistry.search().ok).toBe(true);
    expect(runtime.mcpClient).toBeDefined();
    expect(runtime.traceSink).toBeDefined();
    expect(runtime.createPlanner("provider", "model")).toBeNull();
    expect(runtime.createCoordinator()).toBeDefined();
    expect(runtime.createAgentWorkflow("provider", "model")).toBeNull();

    const execute = vi.fn(async (_input: { query: string }, context: ToolExecutionContext) => {
      expect(context.runId).toBe(runId);
      return ok({ answer: "NEXUS" });
    });
    expect(runtime.toolGateway.register({
      id: "memory.search", version: "1.0.0", description: "Search memory",
      requiredPermissions: ["memory:read"], risk: "low", timeoutMs: 2_000,
      validateInput: (input: unknown) => input !== null && typeof input === "object" && "query" in input
        ? ok(input as { query: string })
        : { ok: false as const, error: { code: "validation" as const, message: "Query is required.", retryable: false } },
      execute
    }).ok).toBe(true);

    const definition: ResumableAgentDefinition<number> = {
      id: agentId, version: "1.0.0", name: "Composition test agent", requiredPermissions: ["tool:execute"],
      maxSteps: 3, timeoutMs: 5_000, createState: input => ({ count: input }),
      async step(state, context) {
        const result = await context.tools.execute<{ answer: string }>("memory.search", { query: "NEXUS" },
          { runId: context.runId, step: context.step, signal: context.signal });
        if (!result.ok) throw new Error(result.error.message);
        return { state: { ...(state as { count: number }), count: (state as { count: number }).count + 1 }, done: true, output: result.value.answer };
      }
    };
    expect(runtime.agentRuntime.register(definition).ok).toBe(true);
    const waiting = await collect(runtime.agentRuntime.start(agentId, 0, "thread-composition"));
    expect(waiting).toEqual([{ type: "waiting_for_approval", runId, permission: "tool:execute" }]);
    const checkpoint = await runtime.checkpointService.get(runId);
    expect(checkpoint).toMatchObject({ ok: true, value: { status: "waiting_for_approval", pendingApproval: { permission: "tool:execute" } } });
    expect((await collect(runtime.agentRuntime.resume(runId, "forged"))).at(-1)).toMatchObject({ type: "failed" });
    agentDecision = "allow";
    const grant = await runtime.issueApproval(runId);
    expect(grant.ok).toBe(true);
    if (!grant.ok) throw new Error("Expected explicit approval grant.");
    const completed = await collect(runtime.agentRuntime.resume(runId, grant.value));
    expect(completed.map(event => event.type)).toEqual(["started", "output", "completed"]);
    expect(completed.find(event => event.type === "output")).toMatchObject({ content: "NEXUS" });
    expect(execute).toHaveBeenCalledOnce();
    expect(policy.authorizeTool).toHaveBeenCalledWith(expect.objectContaining({ actorId: "host-user", scope: "memory:read", resource: "memory.search" }));
    expect(await runtime.auditSink.list({ runId })).toMatchObject({ ok: true, value: [{ status: "started" }, { status: "completed" }] });
    expect(await runtime.checkpointService.get(runId)).toMatchObject({ ok: true, value: { status: "completed" } });
    expect((await collect(runtime.agentRuntime.resume(runId, grant.value))).at(-1)).toMatchObject({ type: "failed" });
  });

  it("connects model planning to checkpointed agents and the permission-enforcing Tool Gateway", async () => {
    let sequence = 0;
    const model = new ModelRouter();
    const provider: ModelProvider = {
      id: "test-provider",
      listModels: async () => ok([]),
      async *stream() {
        yield { type: "text_delta", text: JSON.stringify({ goal: "Find a note", steps: [
          { id: "step-1", toolId: "notes.search", purpose: "Search notes", input: { query: "NEXUS" }, dependsOn: [] }
        ] }) };
        yield { type: "completed" };
      }
    };
    expect(model.register(provider).ok).toBe(true);
    const policy: NexusPermissionPolicy = {
      authorizeAgent: vi.fn(async () => "allow" as const),
      authorizeTool: vi.fn(async request => request.scope === "memory:read" ? "allow" : "deny")
    };
    const runtime = createNexusRuntime({
      storage: new MemoryStorage(), actorId: "host-user", permissions: policy, models: model,
      ids: { runId: () => `run_${++sequence}` as AgentRunId, approvalId: () => "approval-unused" },
      clock: { now: () => 20_000 }
    });
    const execute = vi.fn(async (input: { query: string }) => ok({ matches: [input.query], count: 1 }));
    expect(runtime.toolRegistry.register({
      id: "notes.search", version: "1", description: "Search local notes",
      requiredPermissions: ["memory:read"], risk: "low", timeoutMs: 1_000,
      validateInput: (input: unknown) => input !== null && typeof input === "object" && "query" in input
        ? ok(input as { query: string })
        : { ok: false as const, error: { code: "validation" as const, message: "Invalid query", retryable: false } },
      execute
    }).ok).toBe(true);

    const workflow = runtime.createAgentWorkflow("test-provider", "test-model", "planned-thread");
    expect(workflow).not.toBeNull();
    if (!workflow) throw new Error("Workflow should be available when a model router is configured.");
    const mcpScoped = runtime.createAgentWorkflow("test-provider", "test-model", "mcp-thread", ["notes.search", "mcp.*"]);
    expect(mcpScoped).not.toBeNull();
    if (!mcpScoped) throw new Error("MCP-scoped workflow should be available.");
    expect(runtime.toolRegistry.register({
      id: "mcp.remote.lookup", version: "mcp-1", description: "Remote lookup",
      requiredPermissions: ["mcp:execute"], risk: "high", timeoutMs: 1_000,
      validateInput: input => ok(input), execute: vi.fn(async () => ok({}))
    }).ok).toBe(true);
    const mcpPlan = await mcpScoped.plan("Find a note", new AbortController().signal);
    expect(mcpPlan.ok).toBe(true);

    const restricted = runtime.createAgentWorkflow("test-provider", "test-model", "restricted-thread", ["not-registered"]);
    expect(restricted).not.toBeNull();
    if (!restricted) throw new Error("Restricted workflow should be available.");
    const blocked = await restricted.plan("Find a note", new AbortController().signal);
    expect(blocked).toMatchObject({ ok: false, error: { message: "No tools allowed for this workflow are registered." } });

    const planned = await workflow.plan("Find a note", new AbortController().signal);
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.error.message);
    const events = await collect(workflow.run(planned.value, "coordination-1" as AgentRunId, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("completed");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith({ query: "NEXUS" }, expect.any(Object));
    expect(await runtime.checkpointService.listByThread("planned-thread")).toMatchObject({
      ok: true, value: [expect.objectContaining({ status: "completed", agentId: "nexus.tool-invocation" })]
    });
    expect(await runtime.auditSink.list()).toMatchObject({ ok: true, value: [
      expect.objectContaining({ status: "started", toolId: "notes.search" }),
      expect.objectContaining({ status: "completed", toolId: "notes.search" })
    ] });
  });

  it("uses default-deny permissions when no host policy is supplied", async () => {
    const runtime = createNexusRuntime({ storage: new MemoryStorage(), actorId: "host-user", ids, clock: { now: () => 20_000 } });
    const registered = runtime.toolGateway.register({
      id: "restricted", version: "1", description: "Restricted tool", requiredPermissions: ["shell:execute"],
      risk: "high", timeoutMs: 1_000, validateInput: input => ok(input), execute: vi.fn(async () => ok("should-not-run"))
    });
    expect(registered.ok).toBe(true);
    const result = await runtime.toolGateway.execute("restricted", {}, toolContext({ runId, traceId: "trace", signal: new AbortController().signal }), "host-user");
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  it("rejects invalid host identity before constructing a runtime", () => {
    expect(() => createNexusRuntime({ storage: new MemoryStorage(), actorId: " " })).toThrow("A valid host actor identity is required.");
  });

  it("blocks a model-planned high-risk tool when the owner denies its permission", async () => {
    const model = new ModelRouter();
    const provider: ModelProvider = {
      id: "denial-test-provider",
      listModels: async () => ok([]),
      async *stream() {
        yield { type: "text_delta", text: JSON.stringify({
          goal: "Modify a protected workspace file",
          steps: [{
            id: "write-step", toolId: "workspace.write",
            purpose: "Write a protected file",
            input: { path: "C:\\approved\\important.txt", content: "change" },
            dependsOn: []
          }]
        }) };
        yield { type: "completed" };
      }
    };
    expect(model.register(provider).ok).toBe(true);
    const policy: NexusPermissionPolicy = {
      authorizeAgent: vi.fn(async () => "allow" as const),
      authorizeTool: vi.fn(async request => request.scope === "filesystem:write:selected" ? "deny" : "allow")
    };
    const runtime = createNexusRuntime({
      storage: new MemoryStorage(), actorId: "host-user", permissions: policy, models: model,
      ids: { runId: () => "denied-run" as AgentRunId, approvalId: () => "unused-approval" },
      clock: { now: () => 30_000 }
    });
    const execute = vi.fn(async () => ok("must never execute"));
    expect(runtime.toolRegistry.register({
      id: "workspace.write", version: "1", description: "Write an approved workspace file",
      requiredPermissions: ["filesystem:write:selected"], risk: "high", timeoutMs: 1_000,
      validateInput: input => input && typeof input === "object" && "path" in input && "content" in input
        ? ok(input as { path: string; content: string })
        : { ok: false as const, error: { code: "validation" as const, message: "Invalid file write", retryable: false } },
      resourceForInput: input => input.path,
      execute
    }).ok).toBe(true);
    const workflow = runtime.createAgentWorkflow("denial-test-provider", "test-model", "denied-thread", ["workspace.write"]);
    expect(workflow).not.toBeNull();
    if (!workflow) throw new Error("Expected a model-backed workflow.");
    const planned = await workflow.plan("Modify a protected workspace file", new AbortController().signal);
    expect(planned.ok).toBe(true);
    if (!planned.ok) throw new Error(planned.error.message);
    const events = await collect(workflow.run(planned.value, "denied-run" as AgentRunId, new AbortController().signal));
    expect(events.at(-1)?.type).toBe("failed");
    expect(execute).not.toHaveBeenCalled();
    expect(policy.authorizeTool).toHaveBeenCalledWith(expect.objectContaining({
      scope: "filesystem:write:selected", risk: "high", resource: expect.stringContaining("C:\\approved\\important.txt")
    }));
    expect(await runtime.auditSink.list()).toMatchObject({
      ok: true, value: [expect.objectContaining({ toolId: "workspace.write", status: "denied" })]
    });
  });

});
