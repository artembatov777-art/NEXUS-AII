import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHistory, saveHistory } from './history';
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

it('a stale terminal session cannot erase a completed turn saved in another session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-session-conflict-'));
  try {
    const file = join(directory, 'history.json');
    const initial = [{ role: 'user' as const, content: 'previous' },
      { role: 'assistant' as const, content: 'reply' }];
    await saveHistory(file, initial);
    const router = new ModelRouter();
    router.register({ id: 'test', listModels: async () => ok([]), async *stream(request) {
      yield { type: 'text_delta' as const, text: `${request.messages.at(-1)?.content ?? ''} answer` };
      yield { type: 'completed' as const };
    } });
    const fresh = new TerminalSession(router, 'test', 'model', await loadHistory(file),
      messages => saveHistory(file, messages));
    const stale = new TerminalSession(router, 'test', 'model', await loadHistory(file),
      messages => saveHistory(file, messages));

    await fresh.send('first', () => {});
    const stored = await loadHistory(file);
    expect(stored.map(message => message.content))
      .toEqual(['previous', 'reply', 'first', 'first answer']);
    await expect(stale.send('second', () => {})).rejects.toThrow(/history changed/i);
    expect(stale.history()).toEqual(initial);
    expect(await loadHistory(file)).toEqual(stored);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
