import { describe, expect, it, vi } from 'vitest';
import { AgentPlanner } from './agentPlanner';
import { ModelRouter } from './model';
import { ModelRouterPlanner } from './modelPlanner';
import { GatewayAgentToolExecutor, type AgentToolExecutor } from './agentToolBridge';
import { ToolGateway, type ToolAuditEvent } from './tools';
import { ToolRegistry } from './toolRegistry';
import { ok } from './result';
import { PlanExecutor as TerminalAgent } from './planExecutor';

describe('terminal agent', () => {
  function setup(allowed: boolean) {
    const audit: ToolAuditEvent[] = [];
    const gateway = new ToolGateway({ authorize: async () => allowed ? 'allow' : 'deny' }, {
      record: async event => { audit.push(event); return ok(undefined); },
      list: async () => ok(audit)
    }, { now: () => 1 });
    const registry = new ToolRegistry(gateway);
    let executions = 0;
    registry.register({ id: 'test.echo', version: '1', description: 'Echo', requiredPermissions: ['filesystem:read:selected'], risk: 'low', timeoutMs: 1000,
      validateInput: input => ok(input), execute: async input => { executions++; return ok(input); } });
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [{ id: 'one', toolId: 'test.echo', purpose: 'echo', input: { text: 'hello' }, dependsOn: [] }] }) });
    return { agent: new TerminalAgent(planner, registry, new GatewayAgentToolExecutor(gateway, 'owner')), audit, executions: () => executions };
  }
  it('executes a validated plan through the permission and audit gateway', async () => {
    const { agent, audit, executions } = setup(true);
    const result = await agent.run('test', 'run-1', new AbortController().signal);
    expect(result).toMatchObject({ ok: true, value: [{ stepId: 'one', output: { text: 'hello' } }] });
    expect(executions()).toBe(1);
    expect(audit.map(event => event.status)).toEqual(['started', 'completed']);
  });
  it('stops when a tool is denied', async () => {
    const { agent, executions } = setup(false);
    const result = await agent.run('test', 'run-2', new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
    expect(executions()).toBe(0);
  });
  it('does not replay a completed run step', async () => {
    const { agent, executions } = setup(true);
    const signal = new AbortController().signal;
    expect((await agent.run('test', 'run-repeat', signal)).ok).toBe(true);
    expect(await agent.run('test', 'run-repeat', signal)).toMatchObject({ ok: false, error: { code: 'tool_failed' } });
    expect(executions()).toBe(1);
  });
  it('does not execute if the run is already cancelled', async () => {
    const { agent, executions } = setup(true);
    const controller = new AbortController(); controller.abort();
    expect(await agent.run('test', 'run-cancelled', controller.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(executions()).toBe(0);
  });
  it('plans from a streamed model response and runs the plan through the gateway', async () => {
    const router = new ModelRouter();
    router.register({ id: 'test-model', listModels: async () => ok([]), async *stream() {
      yield { type: 'text_delta', text: JSON.stringify({ goal: 'inspect', steps: [{ id: 'one', toolId: 'test.echo', purpose: 'inspect', input: { path: 'a' }, dependsOn: [] }] }) };
      yield { type: 'completed' };
    } });
    const events: ToolAuditEvent[] = [];
    const gateway = new ToolGateway({ authorize: async () => 'allow' }, {
      record: async event => { events.push(event); return ok(undefined); },
      list: async () => ok(events)
    }, { now: () => 1 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: 'test.echo', version: '1', description: 'Inspect', requiredPermissions: ['filesystem:read:selected'], risk: 'low', timeoutMs: 1000,
      validateInput: input => ok(input), execute: async input => ok(input) });
    const planner = new AgentPlanner(new ModelRouterPlanner(router, 'test-model', 'test'));
    const agent = new TerminalAgent(planner, registry, new GatewayAgentToolExecutor(gateway, 'owner'));
    expect(await agent.run('inspect', 'model-run', new AbortController().signal)).toMatchObject({ ok: true, value: [{ stepId: 'one', output: { path: 'a' } }] });
    expect(events.map(event => event.status)).toEqual(['started', 'completed']);
  });
  it('does not report completion for an empty plan', async () => {
    const gateway = new ToolGateway({ authorize: async () => 'deny' }, { record: async () => ok(undefined), list: async () => ok([]) }, { now: () => 1 });
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [] }) });
    const executor = new TerminalAgent(planner, new ToolRegistry(gateway), new GatewayAgentToolExecutor(gateway, 'owner'));
    expect(await executor.run('fix project', 'empty-plan', new AbortController().signal)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('refuses to delegate a tool step removed from the registry while the plan was pending', async () => {
    const gateway = new ToolGateway({ authorize: async () => 'allow' }, {
      record: async () => ok(undefined), list: async () => ok([])
    }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: 'read.a', version: '1', description: 'Read', requiredPermissions: [],
      risk: 'low', timeoutMs: 1_000, validateInput: input => ok(input), execute: async () => ok({}) });
    const planner = new AgentPlanner({
      createPlan: async ({ goal }) => {
        const plan = { goal, steps: [{ id: 'one', toolId: 'read.a', purpose: 'Read the file', input: {}, dependsOn: [] }] };
        registry.unregister('read.a');
        return ok(plan);
      }
    });
    const invoked = vi.fn();
    const executor: AgentToolExecutor = { execute: async <Output = unknown>() => {
      invoked();
      return ok({ executed: true } as Output);
    } };
    const agent = new TerminalAgent(planner, registry, executor);
    expect(await agent.run('inspect', 'stale-registry', new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(invoked).not.toHaveBeenCalled();
  });

  it('enforces current tool registration before each subsequent CLI execution step', async () => {
    const gateway = new ToolGateway({ authorize: async () => 'allow' }, {
      record: async () => ok(undefined), list: async () => ok([])
    }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: 'read.a', version: '1', description: 'Read', requiredPermissions: [],
      risk: 'low', timeoutMs: 1_000, validateInput: input => ok(input), execute: async () => ok({}) });
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [
      { id: 'first', toolId: 'read.a', purpose: 'Read A', input: {}, dependsOn: [] },
      { id: 'second', toolId: 'read.a', purpose: 'Read B', input: {}, dependsOn: ['first'] }
    ] }) });
    const invoked = vi.fn();
    const executor: AgentToolExecutor = { execute: async <Output = unknown>(toolId: string) => {
      invoked(toolId);
      registry.unregister('read.a');
      return ok({ executed: true } as Output);
    } };
    const agent = new TerminalAgent(planner, registry, executor);
    expect(await agent.run('inspect', 'dynamic-registry', new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(invoked).toHaveBeenCalledTimes(1);
  });

  it('reports cancellation even if a tool adapter ignores the abort and returns success', async () => {
    const controller = new AbortController();
    const gateway = new ToolGateway({ authorize: async () => "allow" }, {
      record: async () => ok(undefined), list: async () => ok([])
    }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: "read.a", version: "1", description: "Read", requiredPermissions: [],
      risk: "low", timeoutMs: 1_000, validateInput: input => ok(input), execute: async () => ok({}) });
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [
      { id: "one", toolId: "read.a", purpose: "Read", input: {}, dependsOn: [] }
    ] }) });
    const executor: AgentToolExecutor = { execute: async <Output = unknown>() => {
      controller.abort();
      return ok({ uncertainOutcome: true } as Output);
    } };
    const onStep = vi.fn();
    const agent = new TerminalAgent(planner, registry, executor);
    expect(await agent.run("inspect", "cancelled-after-execution", controller.signal, onStep))
      .toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(onStep).not.toHaveBeenCalled();
  });

  it('normalizes an exception from a tool adapter to an ambiguous, non-retryable failure', async () => {
    const gateway = new ToolGateway({ authorize: async () => "allow" }, {
      record: async () => ok(undefined), list: async () => ok([])
    }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: "read.a", version: "1", description: "Read", requiredPermissions: [],
      risk: "low", timeoutMs: 1_000, validateInput: input => ok(input), execute: async () => ok({}) });
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [
      { id: "one", toolId: "read.a", purpose: "Read", input: {}, dependsOn: [] }
    ] }) });
    const executor: AgentToolExecutor = { execute: async () => { throw new Error("Adapter crashed after dispatch"); } };
    const agent = new TerminalAgent(planner, registry, executor);
    const result = await agent.run("inspect", "executor-throws", new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: "tool_failed", retryable: false } });
    if (!result.ok) expect(result.error.message).toMatch(/audit|unknown|outcome/i);
  });

  it('returns a typed error if the planner crashes rather than rejecting the whole run', async () => {
    const gateway = new ToolGateway({ authorize: async () => "allow" }, {
      record: async () => ok(undefined), list: async () => ok([])
    }, { now: () => 0 });
    const planner = new AgentPlanner({ createPlan: async () => { throw new Error("Provider crashed"); } });
    const agent = new TerminalAgent(planner, new ToolRegistry(gateway), {
      execute: async () => ok({})
    });
    expect(await agent.run("inspect", "planner-exception", new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
  });

  it('returns an auditable failure if a UI step callback throws after the tool completed', async () => {
    const gateway = new ToolGateway({ authorize: async () => "allow" }, {
      record: async () => ok(undefined), list: async () => ok([])
    }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: "read.a", version: "1", description: "Read", requiredPermissions: [],
      risk: "low", timeoutMs: 1_000, validateInput: input => ok(input), execute: async () => ok({}) });
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [
      { id: "one", toolId: "read.a", purpose: "Read", input: {}, dependsOn: [] }
    ] }) });
    const executor = { execute: async () => ok({ executed: true }) };
    const agent = new TerminalAgent(planner, registry, executor);
    const result = await agent.run("inspect", "observer-error", new AbortController().signal,
      () => { throw new Error("Terminal output disconnected"); });
    expect(result).toMatchObject({ ok: false, error: { code: "internal", retryable: false } });
    if (!result.ok) expect(result.error.message).toMatch(/audit|completed|observer/i);
  });
});
