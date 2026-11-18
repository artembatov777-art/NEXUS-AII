import { quoteTerminal } from './quote';
import type { PermissionRequest, PermissionService } from '../src/core/tools';

/** Permission is per invocation and fails closed when input is unavailable. */
export class TerminalPermissions implements PermissionService {
  constructor(private readonly ask: ((prompt: string) => Promise<string>) | null) {}

  async authorize(request: PermissionRequest): Promise<'allow' | 'deny'> {
    if (!this.ask) return 'deny';
    const prompt = `Allow ${quoteTerminal(request.scope)} on ${quoteTerminal(request.resource ?? '')} (${request.risk} risk)? Type yes to allow: `;
    try { return (await this.ask(prompt)).trim().toLowerCase() === 'yes' ? 'allow' : 'deny'; }
    catch { return 'deny'; }
  }
}
