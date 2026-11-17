/** Filters terminal control sequences from untrusted streamed model output. */
export class TerminalOutput {
  private state: 'text' | 'escape' | 'csi' | 'string' | 'stringEscape' = 'text';

  filter(chunk: string): string {
    let output = '';
    for (const char of chunk) {
      const code = char.codePointAt(0)!;
      if (this.state === 'string') {
        if (char === '\u0007' || code === 0x9c) this.state = 'text';
        else if (char === '\u001b') this.state = 'stringEscape';
      } else if (this.state === 'stringEscape') {
        this.state = char === '\\' ? 'text' : 'string';
      } else if (this.state === 'csi') {
        if (code >= 0x40 && code <= 0x7e) this.state = 'text';
        else if (char === '\u001b') this.state = 'escape';
      } else if (this.state === 'escape') {
        if (char === '[') this.state = 'csi';
        else if (']PX^_'.includes(char)) this.state = 'string';
        else this.state = 'text';
      } else if (char === '\u001b') this.state = 'escape';
      else if (code === 0x9b) this.state = 'csi';
      else if ([0x90, 0x98, 0x9d, 0x9e, 0x9f].includes(code)) this.state = 'string';
      else if (char === '\n' || char === '\t' || (code >= 0x20 && !(code >= 0x7f && code <= 0x9f) && code !== 0x200e && code !== 0x200f && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069))) output += char;
    }
    return output;
  }
}
