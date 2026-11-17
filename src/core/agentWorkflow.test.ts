import { describe, expect, it } from 'vitest';
import { AgentPlanner } from './agentPlanner';
import { createAgentWorkflow } from './agentWorkflow';
import { ToolGateway } from './tools';
import { ToolRegistry } from './toolRegistry';
import { ok } from './result';
import { MultiAgentCoordinator } from './multiAgentCoordinator';
import type { AgentId } from './agents';

describe('shared agent workflow', () => {
  it('honours the host tool allowlist before asking the planner', async () => {
    const gateway = new ToolGateway({ authorize: async () => 'deny' }, { record: async () => ok(undefined), list: async () => ok([]) }, { now: () => 0 });
    const registry = new ToolRegistry(gateway);
    registry.register({ id: 'safe.read', version: '1', description: 'Read', requiredPermissions: ['filesystem:read:selected'], risk: 'low', timeoutMs: 1000, validateInput: value => ok(value), execute: async value => ok(value) });
    registry.register({ id: 'shell.exec', version: '1', description: 'Shell', requiredPermissions: ['shell:execute'], risk: 'high', timeoutMs: 1000, validateInput: value => ok(value), execute: async value => ok(value) });
    let offered: string[] = [];
    const planner = new AgentPlanner({ createPlan: async ({ goal, tools }) => { offered = tools.map(tool => tool.id); return ok({ goal, steps: [] }); } });
    const coordinator = new MultiAgentCoordinator({ execute: async () => ok(null) }, { authorize: async () => 'deny' }, { append: async () => ok(undefined), list: async () => ok([]) }, { now: () => 0 });
    const workflow = createAgentWorkflow(planner, registry, coordinator, 'agent' as AgentId, ['safe.read']);
    expect((await workflow.plan('inspect', new AbortController().signal)).ok).toBe(true);
    expect(offered).toEqual(['safe.read']);
  });
});
