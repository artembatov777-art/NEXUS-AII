import { describe, expect, it } from 'vitest';
import { parseTerminalCommand } from './terminalCommands';

describe('desktop terminal commands', () => {
  it('leaves ordinary messages for the existing model runtime', () => {
    expect(parseTerminalCommand('explain this')).toBeNull();
  });
  it.each(['help', 'clear', 'models', 'agents', 'status', 'history', 'settings'] as const)('recognizes /%s', command => {
    expect(parseTerminalCommand(`/${command}`)).toEqual({ type: command });
  });
  it('does not silently send unknown commands or arguments to a model', () => {
    expect(parseTerminalCommand('/unknown')).toEqual({ type: 'invalid', message: 'Unknown command. Use /help for available commands.' });
    expect(parseTerminalCommand('/clear now')?.type).toBe('invalid');
  });
  it('passes an agent task as a draft rather than running it', () => {
    expect(parseTerminalCommand('/agents inspect this project')).toEqual({ type: 'agents', task: 'inspect this project' });
  });
});
