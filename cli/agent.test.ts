import { describe, expect, it } from 'vitest';
import { AgentPlanner } from '../src/core/agentPlanner';
import { ModelRouter } from '../src/core/model';
import { ModelRouterPlanner } from '../src/core/modelPlanner';
import { GatewayAgentToolExecutor } from '../src/core/agentToolBridge';
import { ToolGateway, type ToolAuditEvent } from '../src/core/tools';
import { ToolRegistry } from '../src/core/toolRegistry';
import { ok } from '../src/core/result';
import { TerminalAgent } from './agent';

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
});
