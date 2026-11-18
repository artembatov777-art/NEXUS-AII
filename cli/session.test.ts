import { describe, expect, it } from 'vitest';
import { ModelRouter, type ModelProvider } from '../src/core/model';
import { ok } from '../src/core/result';
import { TerminalSession } from './session';

describe('terminal session', () => {
  it('streams the response and retains successful conversation context', async () => {
    const requests: string[][] = [];
    const provider: ModelProvider = { id: 'test', listModels: async () => ok([]), async *stream(request) {
      requests.push(request.messages.map(m => m.content));
      yield { type: 'text_delta', text: 'answer' };
      yield { type: 'completed' };
    }};
    const router = new ModelRouter(); router.register(provider);
    const session = new TerminalSession(router, 'test', 'model');
    let output = '';
    await session.send('hello', text => { output += text; });
    await session.send('next', () => {});
    expect(output).toBe('answer');
    expect(requests).toEqual([['hello'], ['hello', 'answer', 'next']]);
  });
  it('does not save an interrupted or incomplete response', async () => {
    const router = new ModelRouter();
    router.register({ id: 'test', listModels: async () => ok([]), async *stream() { yield { type: 'text_delta', text: 'partial' }; } });
    const session = new TerminalSession(router, 'test', 'model');
    await expect(session.send('hello', () => {})).rejects.toThrow('completion');
    expect(session.history()).toEqual([]);
  });
  it('discards a response when cancelled during streaming', async () => {
    const controller = new AbortController();
    const router = new ModelRouter();
    router.register({ id: 'test', listModels: async () => ok([]), async *stream() {
      yield { type: 'text_delta', text: 'partial' };
      controller.abort();
      yield { type: 'completed' };
    } });
    const session = new TerminalSession(router, 'test', 'model');
    await expect(session.send('hello', () => {}, controller.signal)).rejects.toThrow('cancelled');
    expect(session.history()).toEqual([]);
  });
  it('bounds model output before saving it', async () => {
    const router = new ModelRouter();
    router.register({ id: 'test', listModels: async () => ok([]), async *stream() {
      yield { type: 'text_delta', text: 'x'.repeat(100001) };
      yield { type: 'completed' };
    } });
    const session = new TerminalSession(router, 'test', 'model');
    await expect(session.send('hello', () => {})).rejects.toThrow('limit');
    expect(session.history()).toEqual([]);
  });
});

it('does not retain a turn when durable history fails', async () => {
  const router = new ModelRouter();
  router.register({ id: 'test', listModels: async () => ok([]), async *stream() { yield { type: 'text_delta', text: 'answer' }; yield { type: 'completed' }; } });
  const session = new TerminalSession(router, 'test', 'model', [], async () => { throw new Error('disk full'); });
  await expect(session.send('hello', () => {})).rejects.toThrow('disk full');
  expect(session.history()).toEqual([]);
});
