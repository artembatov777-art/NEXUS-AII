import { describe, expect, it, vi } from 'vitest';
import { ToolGateway, type ToolAuditEvent } from '../src/core/tools';
import { ok, err } from '../src/core/result';
import { registerCliWorkspaceTools, type WorkspaceBackend } from './workspace';

function setup(allow = true) {
  const events: ToolAuditEvent[] = [];
  const gateway = new ToolGateway({ authorize: async () => allow ? 'allow' : 'deny' }, { record: async e => { events.push(e); return ok(undefined); }, list: async () => ok(events) }, { now: () => 1 });
  const backend: WorkspaceBackend = { invoke: vi.fn(async request => request.operation === 'read' ? ok({ content: 'hello' }) : ok({ entries: [] })) };
  registerCliWorkspaceTools(gateway, backend);
  let n = 0;
  const call = (tool: string, input: unknown, signal = new AbortController().signal) => gateway.execute(tool, input, { runId: 'run', traceId: String(++n), signal }, 'owner');
  return { backend, call };
}
describe('workspace gateway adapter', () => {
  it('routes an approved read through the gateway', async () => {
    const { backend, call } = setup();
    expect(await call('cli.workspace.read', { root: '/project', path: 'file.txt' })).toEqual(ok({ content: 'hello' }));
    expect(backend.invoke).toHaveBeenCalledOnce();
  });
  it('denies access before invoking backend when permission is refused', async () => {
    const { backend, call } = setup(false);
    expect((await call('cli.workspace.read', { root: '/project', path: 'file.txt' })).ok).toBe(false);
    expect(backend.invoke).not.toHaveBeenCalled();
  });
  it('rejects traversal and absolute paths before backend invocation', async () => {
    const { backend, call } = setup();
    for (const path of ['../secret', '/etc/passwd', 'a/../secret', 'a\\..\\secret']) expect((await call('cli.workspace.read', { root: '/project', path })).ok).toBe(false);
    expect(backend.invoke).not.toHaveBeenCalled();
  });
  it('passes cancellation to the backend and reports failure', async () => {
    const { backend, call } = setup();
    const c = new AbortController(); c.abort();
    expect(await call('cli.workspace.read', { root: '/project', path: 'x' }, c.signal)).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(backend.invoke).not.toHaveBeenCalled();
  });
  it('propagates backend errors without claiming access', async () => {
    const { backend, call } = setup();
    vi.mocked(backend.invoke).mockResolvedValue(err('tool_failed', 'backend unavailable'));
    expect(await call('cli.workspace.read', { root: '/project', path: 'x' })).toMatchObject({ ok: false, error: { message: 'backend unavailable' } });
  });
});

it('rejects malformed and oversized backend responses', async () => {
  const { backend, call } = setup();
  vi.mocked(backend.invoke).mockResolvedValueOnce(ok({ content: 'x'.repeat(48001) })).mockResolvedValueOnce(ok({ wrong: true }));
  for (let i = 0; i < 2; i++) expect(await call('cli.workspace.read', { root: '/project', path: 'x' })).toMatchObject({ ok: false, error: { code: 'tool_failed' } });
});

it('propagates native symlink and boundary denial without treating it as success', async () => {
  const { backend, call } = setup();
  vi.mocked(backend.invoke).mockResolvedValue(err('permission_denied', 'link or path outside approved root'));
  expect(await call('cli.workspace.read', { root: '/project', path: 'link' })).toMatchObject({ ok: false, error: { code: 'permission_denied' } });
});

it('aborts an in-flight backend operation', async () => {
  const { backend, call } = setup();
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  let observed = false;
  vi.mocked(backend.invoke).mockImplementation(async (_request, signal) => {
    started();
    await new Promise<void>(resolve => signal.addEventListener('abort', () => { observed = true; resolve(); }, { once: true }));
    return err('cancelled', 'cancelled');
  });
  const controller = new AbortController();
  const result = call('cli.workspace.read', { root: '/project', path: 'x' }, controller.signal);
  await ready;
  controller.abort();
  expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
  expect(observed).toBe(true);
});
