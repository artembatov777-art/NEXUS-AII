import { err, ok, type Result } from '../src/core/result';
import type { ToolGateway } from '../src/core/tools';

/** Implementations must enforce root grants and no-follow lookups in the native host. */
export interface WorkspaceBackend {
  invoke(request: { operation: 'list' | 'read' | 'search'; root: string; path: string; query?: string }, signal: AbortSignal): Promise<Result<unknown>>;
}
type Input = { root: string; path: string; query?: string };
const byteLength = (s: string) => new TextEncoder().encode(s).byteLength;
function validate(input: unknown, operation: 'list' | 'read' | 'search'): Result<Input> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return err('validation', 'Workspace input is invalid.');
  const item = input as Record<string, unknown>;
  if (typeof item.root !== 'string' || !item.root.trim() || item.root.length > 4096 || /[\x00-\x1f\x7f]/.test(item.root) || typeof item.path !== 'string' || item.path.length > 4096 || /[\x00-\x1f\x7f]/.test(item.path) || /^(?:[\\/]|[A-Za-z]:)/.test(item.path) || item.path.split(/[\\/]/).some(part => part === '..')) return err('validation', 'Workspace root or relative path is invalid.');
  if (operation === 'read' && !item.path) return err('validation', 'A file path is required.');
  if (operation === 'search' && (typeof item.query !== 'string' || !item.query.trim() || item.query.length > 256)) return err('validation', 'Search query is invalid.');
  return ok({ root: item.root, path: item.path, ...(operation === 'search' ? { query: item.query as string } : {}) });
}

/** Gateway validation is defense in depth, never a substitute for native path safety. */
export function registerCliWorkspaceTools(gateway: ToolGateway, backend: WorkspaceBackend): void {
  for (const operation of ['list', 'read', 'search'] as const) {
    const result = gateway.register<Input, unknown>({
      id: `cli.workspace.${operation}`, version: '1', description: `Workspace ${operation}`, requiredPermissions: ['filesystem:read:selected'], risk: 'medium', timeoutMs: 15_000,
      validateInput: input => validate(input, operation), resourceForInput: input => `${input.root}/${input.path}`,
      execute: async (input, context) => {
        try {
          const response = await backend.invoke({ operation, ...input }, context.signal);
          if (context.signal.aborted) return err('cancelled', 'Workspace operation cancelled.');
          if (!response || typeof response !== 'object' || typeof response.ok !== 'boolean') return err('tool_failed', 'Invalid workspace backend response.');
          if (!response.ok) {
            const failure = response.error;
            const allowedCodes = ['validation', 'permission_denied', 'timeout', 'cancelled', 'tool_failed', 'storage_failed'];
            if (!failure || typeof failure !== 'object' || !allowedCodes.includes(failure.code) || typeof failure.message !== 'string' || !failure.message.trim() || failure.message.length > 1000 || typeof failure.retryable !== 'boolean') return err('tool_failed', 'Invalid workspace backend response.');
            return err(failure.code, failure.message, failure.retryable);
          }
          const value = response.value;
          if (!value || typeof value !== 'object' || Array.isArray(value)) return err('tool_failed', 'Invalid workspace backend response.');
          const data = value as Record<string, unknown>;
          if (operation === 'read' ? typeof data.content !== 'string' || byteLength(data.content) > 48_000 : !Array.isArray(data.entries) || data.entries.length > 100) return err('tool_failed', 'Invalid or oversized workspace backend response.');
          return response;
        } catch { return err('tool_failed', 'Workspace backend unavailable or returned an invalid response.'); }
      }
    });
    if (!result.ok) throw new Error(result.error.message);
  }
}
