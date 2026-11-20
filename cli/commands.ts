import { quoteTerminal } from './quote';
import { renderHistoryCommand } from './historyView';
import type { ModelMessage } from '../src/core/model';
import type { TerminalStepResult } from './agent';
import type { Result } from '../src/core/result';

interface CommandContext {
  workspace?: (line: string, signal: AbortSignal) => Promise<string>;
  history?: () => readonly ModelMessage[];
  audit?: (line: string) => Promise<string>;
  checkpoint?: (line: string) => Promise<string>;
  run(goal: string, runId: string, signal: AbortSignal, onStep: (step: TerminalStepResult) => void): Promise<Result<TerminalStepResult[]>>;
  write(text: string): void;
  newId(): string;
  signal: AbortSignal;
}

/** Returns false when the input should be handled as a chat prompt. */
export async function dispatchCommand(input: string, context: CommandContext): Promise<boolean> {
  if (/^\/checkpoints?(?:\s|$)/.test(input)) {
    if (!context.checkpoint) {
      context.write("Local CLI checkpoint inspection is unavailable.\n");
    } else {
      try { context.write(await context.checkpoint(input)); }
      catch { context.write("CLI checkpoint storage is unavailable or unreadable.\n"); }
    }
    return true;
  }
  if (/^\/audit(?:\s|$)/.test(input)) {
    if (!context.audit) {
      context.write("Local workspace audit is unavailable in this session.\n");
    } else {
      try { context.write(await context.audit(input)); }
      catch { context.write("Workspace audit is unavailable or unreadable.\n"); }
    }
    return true;
  }
  if (/^\/history(?:\s|$)/.test(input)) {
    if (!context.history) context.write('Local CLI history is unavailable in this session.\n');
    else context.write(renderHistoryCommand(input, context.history()) ?? 'History command is invalid.\n');
    return true;
  }
  if (/^\/(project|files|read|search|draft|approve|apply|recover|rollback|discard)(?:\s|$)/.test(input) ||
      /^\/agent\s+(?:plan(?:\s|$)|(?:inspect|diff|status)\s*$)/.test(input)) {
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
