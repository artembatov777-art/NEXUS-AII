import { describe, expect, it, vi } from 'vitest';
import { AgentPlanner } from './agentPlanner';
import { createAgentWorkflow } from './agentWorkflow';
import { ToolGateway } from './tools';
import { ToolRegistry } from './toolRegistry';
import { ok } from './result';
import { MultiAgentCoordinator } from './multiAgentCoordinator';
import type { AgentId, AgentRunId } from './agents';

describe('shared agent workflow', () => {
  it('honours the host tool allowlist before asking the planner', async () => {
    const gateway = new ToolGateway({ authorize: async () => 'deny' }, { record: async () => ok(undefined), list: async () => ok([]) }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: 'safe.read', version: '1', description: 'Read', requiredPermissions: ['filesystem:read:selected'], risk: 'low', timeoutMs: 1000, validateInput: value => ok(value), execute: async value => ok(value) });
    registry.register({ id: 'shell.exec', version: '1', description: 'Shell', requiredPermissions: ['shell:execute'], risk: 'high', timeoutMs: 1000, validateInput: value => ok(value), execute: async value => ok(value) });
    let offered: string[] = [];
    const planner = new AgentPlanner({ createPlan: async ({ goal, tools }) => { offered = tools.map(tool => tool.id); return ok({ goal, steps: [] }); } });
    const coordinator = new MultiAgentCoordinator({ execute: async () => ok(null) }, { authorize: async () => 'deny' }, { append: async () => ok(undefined), list: async () => ok([]) }, { now: () => 0 });
    const workflow = createAgentWorkflow(planner, registry, coordinator, 'agent' as AgentId, ownerAllowedTools);
    expect((await workflow.plan('inspect', new AbortController().signal)).ok).toBe(true);
    expect(offered).toEqual(['safe.read']);
  });

  function setupExecution(ownerAllowedTools: string[] = ['safe.read']) {
    const gateway = new ToolGateway({ authorize: async () => 'allow' }, {
      record: async () => ok(undefined), list: async () => ok([])
    }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: 'safe.read', version: '1', description: 'Read', requiredPermissions: ['filesystem:read:selected'],
      risk: 'low', timeoutMs: 1_000, validateInput: value => ok(value), execute: async value => ok(value) });
    registry.register({ id: 'shell.exec', version: '1', description: 'Shell', requiredPermissions: ['shell:execute'],
      risk: 'high', timeoutMs: 1_000, validateInput: value => ok(value), execute: async value => ok(value) });
    const execute = vi.fn(async () => ok('executed'));
    let decision: 'allow' | 'ask_user' = 'allow';
    const coordinator = new MultiAgentCoordinator({ execute },
      { authorize: async () => decision },
      { append: async () => ok(undefined), list: async () => ok([]) }, { now: () => 0 }, 12);
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [
      { id: 'step-1', toolId: 'safe.read', purpose: 'Inspect file', input: { path: 'a.txt' }, dependsOn: [] }
    ] }) });
    const workflow = createAgentWorkflow(planner, registry, coordinator, 'agent' as AgentId, ['safe.read']);
    const events = async (source: AsyncIterable<unknown>) => { const received: unknown[] = []; for await (const value of source) received.push(value); return received; };
    const id = 'run-security' as AgentRunId;
    return { registry, execute, workflow, events, id, ownerAllowedTools,
      setDecision: (next: 'allow' | 'ask_user') => { decision = next; } };
  }

  it('blocks a forged high-risk tool plan at the Desktop execution boundary', async () => {
    const { workflow, execute, events, id } = setupExecution();
    const plan = { goal: 'inspect', steps: [{ id: 'rogue', toolId: 'shell.exec',
      purpose: 'Run a command outside the allowed tool set', input: { command: 'echo test' }, dependsOn: [] }] };
    const result = await events(workflow.run(plan, id, new AbortController().signal));
    expect(result).toEqual([expect.objectContaining({ type: 'failed' })]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a previously allowed tool that was unregistered after planning', async () => {
    const { workflow, registry, execute, events, id } = setupExecution();
    const planned = await workflow.plan('inspect', new AbortController().signal);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    registry.unregister('safe.read');
    const result = await events(workflow.run(planned.value, id, new AbortController().signal));
    expect(result).toEqual([expect.objectContaining({ type: 'failed' })]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rechecks the tool allowlist after an owner approval pause before delegation', async () => {
    const { workflow, registry, execute, events, id, setDecision } = setupExecution();
    const planned = await workflow.plan('inspect', new AbortController().signal);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    setDecision('ask_user');
    const paused = await events(workflow.run(planned.value, id, new AbortController().signal));
    expect(paused).toContainEqual(expect.objectContaining({ type: 'waiting_for_approval' }));
    registry.unregister('safe.read');
    setDecision('allow');
    const resumed = await events(workflow.resume(id, new AbortController().signal));
    expect(resumed).toContainEqual(expect.objectContaining({ type: 'failed' }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks second-step delegation when a registered tool disappears during execution', async () => {
    const { workflow, registry, execute, events, id } = setupExecution();
    execute.mockImplementation(async () => {
      registry.unregister('safe.read');
      return ok('first completed');
    });
    const plan = { goal: 'inspect', steps: [
      { id: 'first', toolId: 'safe.read', purpose: 'Read A', input: {}, dependsOn: [] },
      { id: 'second', toolId: 'safe.read', purpose: 'Read B', input: {}, dependsOn: ['first'] }
    ] };
    const result = await events(workflow.run(plan, id, new AbortController().signal));
    expect(result).toContainEqual(expect.objectContaining({ type: 'failed' }));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a re-registered tool with the same ID after an approval pause', async () => {
    const { workflow, registry, execute, events, id, setDecision } = setupExecution();
    const planned = await workflow.plan('inspect', new AbortController().signal);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    setDecision('ask_user');
    const paused = await events(workflow.run(planned.value, id, new AbortController().signal));
    expect(paused).toContainEqual(expect.objectContaining({ type: 'waiting_for_approval' }));

    registry.unregister('safe.read');
    registry.register({ id: 'safe.read', version: '1', description: 'Read', requiredPermissions: ['filesystem:read:selected'],
      risk: 'low', timeoutMs: 1_000, validateInput: value => ok(value), execute: async value => ok(value) });
    setDecision('allow');
    const resumed = await events(workflow.resume(id, new AbortController().signal));
    expect(resumed).toContainEqual(expect.objectContaining({ type: 'failed' }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('honors a narrowed owner tool list while an earlier plan waits for approval', async () => {
    const allowed = ['safe.read'];
    const { workflow, execute, events, id, setDecision } = setupExecution(allowed);
    const planned = await workflow.plan('inspect', new AbortController().signal);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    setDecision('ask_user');
    expect(await events(workflow.run(planned.value, id, new AbortController().signal)))
      .toContainEqual(expect.objectContaining({ type: 'waiting_for_approval' }));
    allowed.length = 0; // Owner revoked the previously allowed tool.
    setDecision('allow');

    expect(await events(workflow.resume(id, new AbortController().signal)))
      .toContainEqual(expect.objectContaining({ type: 'failed' }));
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not delegate a planned tool after the owner revoked it before execution', async () => {
    const allowed = ['safe.read'];
    const { workflow, execute, events, id } = setupExecution(allowed);
    const planned = await workflow.plan('inspect', new AbortController().signal);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    allowed.length = 0;
    expect(await events(workflow.run(planned.value, id, new AbortController().signal)))
      .toEqual([expect.objectContaining({ type: 'failed' })]);
    expect(execute).not.toHaveBeenCalled();
  });
});
