import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute, join } from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ok, err } from '../src/core/result';
import { ToolGateway, type PermissionService, type ToolAuditEvent } from '../src/core/tools';
import { registerCliWorkspaceTools } from './workspace';
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
  registerCliWorkspaceTools(gateway,{
    async invoke({operation,path,query,root:requested},signal) {
      if (!host || requested !== root) return err('permission_denied','Select a project first.');
      const reply = await host.exchange({version:1,operation,path,query},signal);
      if (reply.ok === true) return ok(reply.value);
      if (reply.ok === false && typeof reply.message === 'string') return err('tool_failed',reply.message);
      return err('tool_failed','Invalid workspace backend response.');
    }
  });
  return {
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
        host?.close(); host=next; root=arg;
        return 'Selected '+quoteTerminal(root);
      }
      if (!host) return 'No project selected. Use /project <absolute directory>.';
      const operation = command === '/files' ? 'list' : command === '/read' ? 'read' : 'search';
      const input = operation === 'search' ? {root,path:'',query:arg} : {root,path:arg};
      const result = await gateway.execute('cli.workspace.'+operation,input,{runId:randomUUID(),traceId:randomUUID(),signal},'owner');
      return quoteTerminal(result.ok ? result.value : result.error.message);
    }
  };
}
