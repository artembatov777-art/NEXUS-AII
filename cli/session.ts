import type { ModelMessage, ModelRouter } from '../src/core/model';

/** Holds only complete turns; a failed or cancelled stream never enters history. */
export class TerminalSession {
  private messages: ModelMessage[] = [];
  private running = false;
  constructor(private readonly router: ModelRouter, private readonly provider: string, private readonly model: string, initial: ModelMessage[] = [], private readonly save?: (messages: ModelMessage[]) => Promise<void>) { this.messages = initial.map(message => ({ ...message })); }

  history(): ModelMessage[] { return this.messages.map(message => ({ ...message })); }
  clear(): void { if (this.running) throw new Error('Cannot clear an active request.'); this.messages = []; }

  async send(input: string, onText: (text: string) => void, signal?: AbortSignal): Promise<void> {
    if (this.running) throw new Error('A request is already running.');
    const content = input.trim();
    if (!content) throw new Error('Message cannot be empty.');
    const messages: ModelMessage[] = [...this.messages, { role: 'user', content }];
    let response = '';
    let responseBytes = 0;
    let completed = false;
    this.running = true;
    try {
      for await (const event of this.router.stream(this.provider, { model: this.model, messages, signal })) {
        if (signal?.aborted) throw new Error('Request cancelled.');
        if (event.type === 'text_delta') {
          responseBytes += new TextEncoder().encode(event.text).byteLength;
          if (responseBytes > 100_000) throw new Error('Model output exceeds the 100 KB limit.');
          response += event.text; onText(event.text);
        }
        if (event.type === 'completed') completed = true;
      }
      if (signal?.aborted) throw new Error('Request cancelled.');
      if (!completed) throw new Error('Model stream ended without completion.');
      const next: ModelMessage[] = [...messages, { role: 'assistant', content: response }];
      if (this.save) await this.save(next);
      this.messages = next;
    } finally { this.running = false; }
  }
}
