import { describe, expect, it, vi } from 'vitest';
import { dispatchCommand } from './commands';
import { ok, err } from '../src/core/result';

describe('terminal commands', () => {
  it('routes agent goals and displays completed steps', async () => {
    const output: string[] = [];
    const run = vi.fn(async (_goal, _id, _signal, onStep) => {
      onStep({ stepId: 'read', output: { content: 'hello' } });
      return ok([{ stepId: 'read', output: { content: 'hello' } }]);
    });
    expect(await dispatchCommand('/agent inspect the project', { run, write: value => output.push(value), newId: () => 'run-1', signal: new AbortController().signal })).toBe(true);
    expect(run).toHaveBeenCalledWith('inspect the project', 'run-1', expect.anything(), expect.any(Function));
    expect(output.join('')).toContain('read');
  });
  it('reports an agent failure and leaves unrelated input for chat', async () => {
    const output: string[] = [];
    const context = { run: async () => err('permission_denied', 'Denied'), write: (value: string) => output.push(value), newId: () => 'run-1', signal: new AbortController().signal };
    expect(await dispatchCommand('/agent test', context)).toBe(true);
    expect(output.join('')).toContain('Denied');
    expect(await dispatchCommand('hello', context)).toBe(false);
  });
});
