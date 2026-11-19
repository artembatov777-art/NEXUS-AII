/** Commands are handled locally; an unrecognized slash command must never reach a provider. */
export type TerminalCommand =
  | { type: 'help' | 'clear' | 'models' | 'status' | 'history' | 'settings' }
  | { type: 'agents'; task?: string }
  | { type: 'invalid'; message: string };

export function parseTerminalCommand(input: string): TerminalCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const [name, ...args] = trimmed.slice(1).split(/\s+/);
  const type = name.toLowerCase();
  if (type === 'agents') {
    const task = args.join(' ').trim();
    return task ? { type, task } : { type };
  }
  if (['help', 'clear', 'models', 'status', 'history', 'settings'].includes(type)) {
    if (args.length) return { type: 'invalid', message: `/${type} does not accept arguments.` };
    return { type: type as 'help' | 'clear' | 'models' | 'status' | 'history' | 'settings' };
  }
  return { type: 'invalid', message: 'Unknown command. Use /help for available commands.' };
}
