import { describe, expect, it, vi } from 'vitest';
import { TerminalPermissions } from './permissions';
import type { PermissionRequest } from '../src/core/tools';

const request: PermissionRequest = { actorId: 'owner', scope: 'shell:execute', resource: 'npm test', reason: 'Run tests', risk: 'high' };
describe('terminal permissions', () => {
  it('denies when interactive approval is unavailable', async () => {
    const ask = vi.fn();
    expect(await new TerminalPermissions(null).authorize(request)).toBe('deny');
    expect(ask).not.toHaveBeenCalled();
  });
  it('allows only an explicit affirmative response', async () => {
    expect(await new TerminalPermissions(async () => 'yes').authorize(request)).toBe('allow');
    for (const answer of ['', 'y', 'no', 'yes please']) {
      expect(await new TerminalPermissions(async () => answer).authorize(request)).toBe('deny');
    }
  });
  it('fails closed if input fails', async () => {
    expect(await new TerminalPermissions(async () => { throw new Error('closed'); }).authorize(request)).toBe('deny');
  });
  it('escapes control characters in untrusted resources shown to the owner', async () => {
    const ask = vi.fn(async () => 'no');
    await new TerminalPermissions(ask).authorize({ ...request, resource: 'file\u001b[2J\nforged' });
    const prompt = ask.mock.calls[0][0] as string;
    expect(prompt).not.toContain('\u001b');
    expect(prompt).not.toContain('\n');
    expect(prompt).toContain('\\u001b');
  });
  it('escapes C1 and bidirectional control characters in prompts', async () => {
    const ask = vi.fn(async (_prompt: string) => 'no');
    await new TerminalPermissions(ask).authorize({ ...request, resource: 'file\u009b2J\u202eevil' });
    const prompt = ask.mock.calls[0][0];
    expect(prompt).not.toContain('\u009b');
    expect(prompt).not.toContain('\u202e');
  });
});
