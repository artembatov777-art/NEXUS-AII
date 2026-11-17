import { describe, expect, it } from 'vitest';
import { ModelRouter } from '../src/core/model';
import { ok } from '../src/core/result';
import { TerminalSession } from './session';
import { runPrompt } from './runner';

describe('terminal prompt', () => {
  it('routes a prompt through the real model router and streams its reply', async () => {
    const router = new ModelRouter();
    router.register({ id: 'test', listModels: async () => ok([]), async *stream(request) {
      yield { type: 'text_delta', text: `received: ${request.messages.at(-1)?.content}` };
      yield { type: 'completed' };
    } });
    const output: string[] = [];
    const code = await runPrompt(new TerminalSession(router, 'test', 'model'), 'hello', value => output.push(value), () => {});
    expect(code).toBe(0);
    expect(output.join('')).toBe('received: hello\n');
  });
  it('reports failures without declaring success', async () => {
    const output: string[] = [];
    const session = new TerminalSession(new ModelRouter(), 'missing', 'model');
    expect(await runPrompt(session, 'hello', () => {}, value => output.push(value))).toBe(1);
    expect(output.join('')).toContain('not registered');
  });
});
