import type { ModelProvider } from '../src/core/model';
import { ok } from '../src/core/result';

/** Deterministic offline fixture, not an AI model. */
export const testModel: ModelProvider = {
  id: 'test',
  listModels: async () => ok([{ id: 'echo', providerId: 'test', displayName: 'TEST MODEL (echo)', supportsStreaming: true, supportsTools: false, declaredLocation: 'local' }]),
  async *stream(request) {
    const input = request.messages.at(-1)?.content ?? '';
    for (const text of ['[TEST MODEL] ', input]) {
      if (request.signal?.aborted) throw new Error('Request cancelled.');
      yield { type: 'text_delta', text };
    }
    if (request.signal?.aborted) throw new Error('Request cancelled.');
    yield { type: 'completed' };
  }
};
