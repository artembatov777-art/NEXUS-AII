import { describe, expect, it, vi } from 'vitest';
import { WorkspacePlanner } from './workspacePlanner';
import { ToolGateway } from '../src/core/tools';
import { ToolRegistry } from '../src/core/toolRegistry';
import type { AgentToolExecutor } from '../src/core/agentToolBridge';
import { ok } from '../src/core/result';

function createWorkspacePlanner() {
  const registry = new ToolRegistry(new ToolGateway(
    { authorize: async () => 'allow' },
    { record: async () => ok(undefined), list: async () => ok([]) },
    { now: () => 10 }
  ));
  for (const action of ['read', 'list', 'search']) {
    const registered = registry.register({
      id: `cli.workspace.${action}`,
      version: '1',
      description: `Inspect a workspace with ${action}`,
      requiredPermissions: [],
      risk: 'low',
      timeoutMs: 1_000,
      validateInput: (input: unknown) => ok(input),
      execute: async (input: unknown) => ok(input)
    });
    expect(registered.ok).toBe(true);
  }
  const calls: Array<{ toolId: string; input: unknown }> = [];
  const execute = vi.fn(async (toolId: string, input: unknown) => {
    calls.push({ toolId, input });
    return ok(actionResult(toolId));
  });
  const tools: AgentToolExecutor = {
    execute: async <Output = unknown>(toolId: string, input: unknown) =>
      await execute(toolId, input) as ReturnType<typeof ok<Output>>
  };
  return { planner: new WorkspacePlanner(registry, tools), calls, execute };
}

function actionResult(toolId: string) {
  return toolId.endsWith('.read') ? { path: 'first.txt', content: 'content' } :
    { entries: ['first.txt'] };
}

describe('offline workspace inspections use the shared strict plan contract', () => {
  it.each([
    ['list', 'cli.workspace.list', ''],
    ['list src', 'cli.workspace.list', 'src'],
    ['read first.txt', 'cli.workspace.read', 'first.txt']
  ])('executes %s without an undefined optional query field', async (goal, toolId, path) => {
    const { planner, calls } = createWorkspacePlanner();
    const result = await planner.runInspection('C:\\workspace', goal, 'run-clean-query', new AbortController().signal);
    expect(result).toMatchObject({ ok: true, value: [{ stepId: expect.any(String) }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].toolId).toBe(toolId);
    expect(calls[0].input).toEqual({ root: 'C:\\workspace', path });
    expect(Object.hasOwn(calls[0].input as object, 'query')).toBe(false);
  });

  it('keeps a literal search query when it is provided', async () => {
    const { planner, calls } = createWorkspacePlanner();
    const result = await planner.runInspection('C:\\workspace', 'search old first', 'run-search',
      new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ toolId: 'cli.workspace.search',
      input: { root: 'C:\\workspace', path: '', query: 'old first' } }]);
  });

  it('builds a complete offline draft-inspection plan using the strict JSON execution boundary', async () => {
    const { planner, calls } = createWorkspacePlanner();
    const read = vi.fn(async () => ok({ path: 'first.txt', content: 'old first', revision: 'test:1' }));
    const result = await planner.plan('C:\\workspace', JSON.stringify({ goal: 'review fixture' }),
      read, new AbortController().signal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.goal).toBe('review fixture');
    expect(result.value.plan.entries).toEqual(['first.txt']);
    expect(result.value.plan.actions).toEqual([]);
    expect(calls).toEqual([{ toolId: 'cli.workspace.list', input: { root: 'C:\\workspace', path: '' } }]);
    expect(read).not.toHaveBeenCalled();
  });

  it('only sends a query for the actual search step in structured plans', async () => {
    const { planner, calls } = createWorkspacePlanner();
    const result = await planner.plan('C:\\workspace',
      JSON.stringify({ goal: 'inspect', query: 'first', directory: '.' }),
      async () => ok({ path: 'first.txt', content: 'old first' }),
      new AbortController().signal);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { toolId: 'cli.workspace.list', input: { root: 'C:\\workspace', path: '.' } },
      { toolId: 'cli.workspace.search', input: { root: 'C:\\workspace', path: '.', query: 'first' } }
    ]);
  });
});
