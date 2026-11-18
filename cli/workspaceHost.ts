import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ok, err } from '../src/core/result';
import { ToolGateway, type PermissionService, type ToolAuditEvent } from '../src/core/tools';
import { registerCliWorkspaceTools } from './workspace';
import { AgentPlanner } from '../src/core/agentPlanner';
import { GatewayAgentToolExecutor } from '../src/core/agentToolBridge';
import { PlanExecutor } from '../src/core/planExecutor';
import { ToolRegistry } from '../src/core/toolRegistry';
import { quoteTerminal } from './quote';

const executable = fileURLToPath(new URL('./bin/nexus-workspace' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));

class Connection {
  private child;
  private chunks;
  constructor(root: string) {
    this.child = spawn(executable, [root], { shell: false, stdio: ['pipe','pipe','ignore'], windowsHide: true });
    this.chunks = this.child.stdout[Symbol.asyncIterator]();
    this.child.on('error', () => this.close());
    this.child.stdin.on('error', () => this.close());
  }
  close() { this.child.kill('SIGKILL'); this.child.stdout.destroy(); }
  async exchange(request: unknown, signal: AbortSignal) {
    const close = () => this.close();
    const timeout = setTimeout(close, 15000);
    signal.addEventListener('abort', close, {once:true});
    try {
      if (signal.aborted) throw new Error('Cancelled');
      if (request) this.child.stdin.write(JSON.stringify(request) + '\n');
      const buffers: Buffer[] = [];
      let size = 0;
      while (true) {
        const chunk = await this.chunks.next();
        if (chunk.done) throw new Error('Host closed');
        const data: Buffer = chunk.value;
        size += data.length;
        if (size > 64001) throw new Error('Oversized reply');
        buffers.push(data);
        if (data.includes(10)) break;
      }
      const frame = Buffer.concat(buffers);
      if (frame.indexOf(10) !== frame.length-1) throw new Error('Malformed frame');
      const reply = JSON.parse(frame.toString('utf8'));
      if (reply?.version !== 1) throw new Error('Unsupported reply');
      return reply;
    } catch(error) { close(); throw error; }
    finally { clearTimeout(timeout); signal.removeEventListener('abort',close); }
  }
}

export function workspaceSession(permissions: PermissionService) {
  let host: Connection | undefined;
  let root = '';
  let draft: { path: string; before: string; after: string; approved: boolean } | undefined;
  const dir = join(homedir(), '.nexus-au', 'workspace-audit');
  const auditFile = (id: string) => join(dir,id + '.jsonl');
  const gateway = new ToolGateway(permissions, {
    async record(event) {
      await mkdir(dir,{recursive:true,mode:0o700});
      await appendFile(auditFile(event.runId), JSON.stringify(event)+'\n',{mode:0o600});
      return ok(undefined);
    },
    async list(options) {
      try { return ok((await readFile(auditFile(options!.runId!), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as ToolAuditEvent)); }
      catch(error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ok([]); throw error; }
    }
  }, { now: Date.now });
  const registry = new ToolRegistry(gateway);
  registerCliWorkspaceTools(registry,{
    async invoke({operation,path,query,root:requested},signal) {
      if (!host || requested !== root) return err('permission_denied','Select a project first.');
      const reply = await host.exchange({version:1,operation,path,query},signal);
      if (reply.ok === true) return ok(reply.value);
      if (reply.ok === false && typeof reply.message === 'string') return err('tool_failed',reply.message);
      return err('tool_failed','Invalid workspace backend response.');
    }
  });
  const approve = gateway.register({
    id: 'cli.workspace.approve-draft',
    version: '1',
    description: 'Approve the displayed draft in memory without writing to disk',
    requiredPermissions: ['filesystem:read:selected', 'filesystem:write:selected'],
    risk: 'high',
    timeoutMs: 15_000,
    validateInput(input: unknown) {
      return input === null && host && draft && !draft.approved
        ? ok({ host, draft })
        : err('validation', 'Prepare an unapproved draft first.');
    },
    resourceForInput: input => `${root}/${input.draft.path}`,
    async execute(input, context) {
      const reply = await input.host.exchange({version:1,operation:'read',path:input.draft.path}, context.signal);
      if (context.signal.aborted) return err('cancelled', 'Draft approval cancelled.');
      if (reply.ok !== true || reply.value?.content !== input.draft.before) {
        return err('tool_failed', 'File changed or is unavailable. Prepare a new draft.');
      }
      return ok({ approved: true });
    }
  });
  if (!approve.ok) throw new Error(approve.error.message);

  const invoke = <T = unknown>(operation: string, input: unknown, signal: AbortSignal) =>
    gateway.execute<T>(`cli.workspace.${operation}`, input, {runId:randomUUID(), traceId:randomUUID(), signal}, 'owner');

  // The offline planner accepts one explicit task. The selected root comes
  // from this terminal session and the gateway still requires confirmation.
  const planner = new AgentPlanner({
    async createPlan({ goal }) {
      if (!host) return err('permission_denied', 'Select a project first.');
      const match = /^(read|list|search)(?:[ \t]+(.+))?$/.exec(goal);
      if (!match || (!match[2] && match[1] !== 'list')) {
        return err('validation', 'Offline tasks: read <file>, list [directory], search <text>.');
      }
      const [, operation, arg = ''] = match;
      return ok({ goal, steps: [{
        id: operation, toolId: `cli.workspace.${operation}`, purpose: `Workspace ${operation}`,
        input: operation === 'search' ? { root, path: '', query: arg } : { root, path: arg },
        dependsOn: []
      }] });
    }
  }, 1);
  const agent = new PlanExecutor(planner, registry, new GatewayAgentToolExecutor(gateway, 'owner'));
  return {
    run: agent.run.bind(agent),
    close: () => host?.close(),
    async command(line:string, signal:AbortSignal) {
      const [command] = line.split(/\s/,1);
      const arg=line.slice(command.length).trim();
      if (command === '/project') {
        if (!arg) return root ? quoteTerminal(root) : 'No project selected.';
        if (!isAbsolute(arg) || Buffer.byteLength(arg) > 4096 || /[\x00-\x1f\x7f]/.test(arg)) return 'Select a valid absolute project directory.';
        const next = new Connection(arg);
        try {
          if ((await next.exchange(null,signal)).ready !== true) throw new Error();
        } catch { next.close(); return 'Workspace backend unavailable or directory denied.'; }
        host?.close(); host=next; root=arg; draft=undefined;
        return 'Selected '+quoteTerminal(root);
      }
      if (!host) return 'No project selected. Use /project <absolute directory>.';
      if (command === '/discard') {
        draft = undefined;
        return 'Draft discarded.';
      }
      if (command === '/approve') {
        if (arg) return 'Usage: /approve';
        const result = await invoke('approve-draft', null, signal);
        if (!result.ok) return quoteTerminal(result.error.message);
        if (draft) draft.approved = true;
        return 'Draft approved in memory. No file was written.';
      }
      if (command === '/draft') {
        draft = undefined;
        if (Buffer.byteLength(arg) > 48_000) return 'Draft input exceeds 48 KB.';
        let input: unknown;
        try { input = JSON.parse(arg); } catch { return 'Usage: /draft {"path":"file","from":"old","to":"new"}'; }
        if (!input || typeof input !== 'object') return 'Invalid draft input.';
        const { path, from, to } = input as Record<string, unknown>;
        if (typeof path !== 'string' || typeof from !== 'string' || !from || typeof to !== 'string' || from === to) {
          return 'Specify a file and a nonempty, unique span to replace.';
        }
        const result = await invoke<{ content: string }>('read', {root, path}, signal);
        if (!result.ok) return quoteTerminal(result.error.message);
        const before = result.value.content;
        const index = before.indexOf(from);
        if (index < 0 || index !== before.lastIndexOf(from)) return 'Draft span must occur exactly once.';
        const after = before.slice(0, index) + to + before.slice(index + from.length);
        if (Buffer.byteLength(after) > 48_000) return 'Draft result exceeds 48 KB.';
        if (signal.aborted) return 'Draft cancelled.';
        draft = {path, before, after, approved:false};
        return `Draft for ${quoteTerminal(path)} (character offset ${index})\n- ${quoteTerminal(from)}\n+ ${quoteTerminal(to)}\nUse /approve or /discard. No file was written.`;
      }
      const operation = command === '/files' ? 'list' : command === '/read' ? 'read' : 'search';
      const input = operation === 'search' ? {root,path:'',query:arg} : {root,path:arg};
      const result = await invoke(operation, input, signal);
      return quoteTerminal(result.ok ? result.value : result.error.message);
    }
  };
}
