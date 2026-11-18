import { quoteTerminal } from './quote';
import type { TerminalStepResult } from './agent';
import type { Result } from '../src/core/result';

interface CommandContext {
  workspace?: (line: string, signal: AbortSignal) => Promise<string>;
  run(goal: string, runId: string, signal: AbortSignal, onStep: (step: TerminalStepResult) => void): Promise<Result<TerminalStepResult[]>>;
  write(text: string): void;
  newId(): string;
  signal: AbortSignal;
}

/** Returns false when the input should be handled as a chat prompt. */
export async function dispatchCommand(input: string, context: CommandContext): Promise<boolean> {
  if (/^\/(project|files|read|search|draft|approve|apply|discard)(?:\s|$)/.test(input)) {
    if (context.workspace) { context.write(await context.workspace(input, context.signal) + '\n'); return true; }
    context.write('Workspace backend is unavailable; no filesystem access was attempted.\n');
    return true;
  }
  if (input !== '/agent' && !input.startsWith('/agent ')) return false;
  const goal = input.slice('/agent'.length).trim();
  if (!goal) { context.write('Usage: /agent <task>\n'); return true; }
  try {
    const result = await context.run(goal, context.newId(), context.signal, step => {
      context.write(`Step ${quoteTerminal(step.stepId)}: ${quoteTerminal(step.output)}\n`);
    });
    if (!result.ok) context.write(`Agent stopped: ${quoteTerminal(result.error.message)}\n`);
    else context.write('Agent plan completed.\n');
  } catch {
    context.write('Agent stopped unexpectedly. Review the audit before retrying.\n');
  }
  return true;
}
