import { TerminalOutput } from './terminalOutput';
import { quoteTerminal } from './quote';
import type { TerminalSession } from './session';

export async function runPrompt(session: TerminalSession, prompt: string, write: (text: string) => void, error: (text: string) => void, signal?: AbortSignal): Promise<number> {
  try {
    const output = new TerminalOutput();
    await session.send(prompt, text => write(output.filter(text)), signal);
    write('\n');
    return 0;
  } catch (cause) {
    error(`${quoteTerminal(cause instanceof Error ? cause.message : 'Model request failed.')}\n`);
    return 1;
  }
}
