import { describe, expect, it } from 'vitest';
import { TerminalOutput } from './terminalOutput';
describe('terminal output', () => {
  it('preserves plain text and strips terminal controls split across chunks', () => {
    const filter = new TerminalOutput();
    expect([filter.filter('hello\u001b['), filter.filter('2Jworld\u001b]0;title'), filter.filter('\u0007!\n')].join('')).toBe('helloworld!\n');
  });
  it('strips carriage returns and other control characters', () => {
    expect(new TerminalOutput().filter('a\rb\u0000c\td')).toBe('abc\td');
  });
  it('removes bidirectional formatting controls', () => {
    expect(new TerminalOutput().filter('safe\u202eevil\u2069')).toBe('safeevil');
  });
});
