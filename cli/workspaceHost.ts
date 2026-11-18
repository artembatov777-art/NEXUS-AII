import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { lstat, mkdir, open, readFile, type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
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
  editSupported = false;
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

const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const MAX_DRAFT_FILES = 8;
const MAX_EDIT_BYTES = 48_000;
// JSON escapes some characters as six bytes.
const MAX_INTENT_BYTES = MAX_DRAFT_FILES * MAX_EDIT_BYTES * 7;

interface DraftFile {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly revision?: string;
}

interface RecoveryFile {
  path: string;
  revision: string;
  before: string;
  after: string;
  original?: string;
}

interface EditStep {
  phase: string;
  path?: string;
  revision?: string;
}

interface DraftPlan {
  readonly files: readonly DraftFile[];
  readonly hash: string;
  readonly rollbackOf?: string;
  approvedUntil?: number;
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^\d+:\d+:-?\d+:\d+:\d+$/.test(value);
}

function isIntentFile(file: unknown): file is RecoveryFile {
  if (!file || typeof file !== 'object') return false;
  const { path, revision, before, after } = file as Record<string, unknown>;
  return typeof path === 'string' && typeof revision === 'string' &&
    typeof before === 'string' && /^[a-f0-9]{64}$/.test(before) &&
    typeof after === 'string' && /^[a-f0-9]{64}$/.test(after);
}

export function workspaceSession(permissions: PermissionService, report: (text: string) => void) {
  let host: Connection | undefined;
  let root = '';
  let draft: DraftPlan | undefined;
  const dir = join(homedir(), '.nexus-au', 'workspace-audit');
  const auditFile = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('Invalid audit run identifier');
    return join(dir, id + '.jsonl');
  };
  const intentFile = (id: string) => {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid recovery ID');
    return join(dir, id + '.edit.json');
  };
  async function assertPrivateAuditDirectory() {
    for (const path of [dirname(dir), dir]) {
      const metadata = await lstat(path);
      if (!metadata.isDirectory() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077)) {
        throw new Error('Workspace audit directory is not private');
      }
    }
  }

  async function assertPrivateJournal(file: FileHandle, limit: number) {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.uid !== process.getuid?.() || metadata.nlink !== 1 ||
        (metadata.mode & 0o077) || metadata.size > limit) {
      throw new Error('Invalid workspace journal');
    }
  }

  async function readPrivateJournal(path: string, limit: number) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      await assertPrivateJournal(file, limit);
      return await file.readFile('utf8');
    } finally { await file.close(); }
  }

  async function syncAuditDirectory() {
    for (const path of [dir, dirname(dir), homedir()]) {
      const directory = await open(path, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }
  const gateway = new ToolGateway(permissions, {
    async record(event) {
      await mkdir(dir,{recursive:true,mode:0o700});
      const file = await open(auditFile(event.runId), 'a', 0o600);
      try {
        await file.appendFile(JSON.stringify(event)+'\n');
        await file.sync();
      } finally { await file.close(); }
      if (event.toolId === 'cli.workspace.apply-draft' && process.platform === 'linux') {
        await syncAuditDirectory();
      }
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
  const resource = (plan: DraftPlan) => plan.files.length === 1 && !plan.rollbackOf
    ? `${root}/${plan.files[0].path}`
    : `${root} (${plan.files.length} files; plan ${plan.hash}${plan.rollbackOf ? `; rollback of ${plan.rollbackOf}` : ''})`;

  async function preflight(connection: Connection, plan: DraftPlan, signal: AbortSignal) {
    for (const file of plan.files) {
      const reply = await connection.exchange({version:1, operation:'read', path:file.path}, signal);
      if (reply.ok !== true || reply.value?.content !== file.before || reply.value?.revision !== file.revision) {
        return err('tool_failed', `File changed or is unavailable. Prepare a new draft: ${file.path}`);
      }
    }
    return ok(undefined);
  }

  async function recordEditStep(runId: string, event: EditStep) {
    const append = constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    const flags = event.phase === 'preflight-started' ? append | constants.O_CREAT | constants.O_EXCL : append;
    const file = await open(intentFile(runId) + '.steps', flags, 0o600);
    try {
      await assertPrivateJournal(file, 128_000);
      await file.appendFile(JSON.stringify({ ...event, at: new Date().toISOString() }) + '\n');
      await file.sync();
    } finally { await file.close(); }
    await syncAuditDirectory();
  }

  const approve = gateway.register({
    id: 'cli.workspace.approve-draft',
    version: '1',
    description: 'Approve the displayed draft in memory without writing to disk',
    requiredPermissions: ['filesystem:read:selected', 'filesystem:write:selected'],
    risk: 'high',
    timeoutMs: 15_000,
    validateInput(input: unknown) {
      return input === null && host && draft && draft.approvedUntil === undefined
        ? ok({ host, draft })
        : err('validation', 'Prepare an unapproved draft first.');
    },
    resourceForInput: input => resource(input.draft),
    async execute(input, context) {
      const result = await preflight(input.host, input.draft, context.signal);
      return result.ok ? ok({ approved: true }) : result;
    }
  });
  if (!approve.ok) throw new Error(approve.error.message);

  // Keep apply out of the agent tool catalog. Only an explicit terminal
  // command can submit the session's approved, single-use draft.
  const apply = gateway.register({
    id: 'cli.workspace.apply-draft',
    version: '1',
    description: 'Apply the approved workspace draft',
    requiredPermissions: ['filesystem:write:selected'],
    risk: 'high',
    timeoutMs: 15_000,
    validateInput(input: unknown) {
      if (!host?.editSupported) return err('validation', 'This workspace host cannot apply drafts.');
      return input === null && draft?.approvedUntil !== undefined && performance.now() < draft.approvedUntil && draft.files.every(file => typeof file.revision === 'string')
        ? ok({ host, root, draft })
        : err('validation', 'Prepare and approve a new draft first.');
    },
    resourceForInput: input => resource(input.draft),
    async execute(input, context) {
      const current = () => draft === input.draft && host === input.host && !context.signal.aborted &&
        performance.now() < input.draft.approvedUntil!;
      if (!current()) return err('cancelled', 'Draft is no longer current.');

      const intent = {
        version: 3,
        root: input.root,
        plan: input.draft.hash,
        rollbackOf: input.draft.rollbackOf,
        files: input.draft.files.map(({ path, revision, before, after }) =>
          ({ path, revision, before: digest(before), after: digest(after), original: before }))
      };
      const id = context.runId;
      try {
        await assertPrivateAuditDirectory();
        const journal = await open(intentFile(id), 'wx', 0o600);
        try {
          await journal.writeFile(JSON.stringify(intent));
          await journal.sync();
        } finally { await journal.close(); }
        await syncAuditDirectory();
        await recordEditStep(id, { phase: 'preflight-started' });
      } catch {
        return err('storage_failed', 'Cannot persist edit intent. No edit was dispatched.');
      }
      const label = input.draft.rollbackOf ? 'Rollback' : 'Apply';
      report(`${label} attempt ${id}. If interrupted, reselect the project and use /recover ${id}.\n`);

      // This read-only pass finishes for the whole plan before sending any
      // writes. Each native edit repeats its checks under the directory lock.
      try {
        const checked = await preflight(input.host, input.draft, context.signal);
        await recordEditStep(id, { phase: checked.ok ? 'preflight-passed' : 'preflight-failed' });
        if (!checked.ok) return err('tool_failed', `${checked.error.message}. No writes were dispatched.`);
      } catch {
        return err('tool_failed', 'Preflight interrupted; no writes were dispatched.');
      }

      let applied = 0;
      const progress = () => `${applied}/${input.draft.files.length} file(s) confirmed. Use /recover ${id} to inspect every file.`;
      for (const { path, before, after, revision } of input.draft.files) {
        if (!current()) return err('cancelled', `Operation stopped before the next write. ${progress()}`);
        try {
          await recordEditStep(id, { phase: 'dispatch-intent', path });
        } catch {
          return err('storage_failed', `Could not journal the next write. ${progress()}`);
        }
        if (!current()) return err('cancelled', `Operation stopped before the next write. ${progress()}`);
        try {
          const reply = await input.host.exchange({
            version: 1, operation: 'edit', path, expected: before, revision, content: after
          }, context.signal);
          if (reply.ok !== true || reply.value?.applied !== true || !isRevision(reply.value.revision)) {
            await recordEditStep(id, { phase: 'not-confirmed', path });
            const message = reply.ok === false && typeof reply.message === 'string'
              ? reply.message : 'Workspace host did not confirm the edit.';
            return err('tool_failed', `${message} ${progress()}`);
          }
          await recordEditStep(id, { phase: 'applied', path, revision: reply.value.revision });
          applied++;
        } catch {
          // The last write may have passed rename even if IPC or journaling
          // failed. Do not replay or compensate automatically.
          return err('tool_failed', `Write or journal interrupted. The edit outcome is unknown. ${progress()}`);
        }
      }
      return ok({ applied });
    }
  });
  if (!apply.ok) throw new Error(apply.error.message);

  const invoke = <T = unknown>(operation: string, input: unknown, signal: AbortSignal,
    runId = randomUUID(), traceId: string = randomUUID()) =>
    gateway.execute<T>(`cli.workspace.${operation}`, input, {runId, traceId, signal}, 'owner');

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
          const ready = await next.exchange(null,signal);
          if (ready.ready !== true) throw new Error();
          next.editSupported = process.platform === 'linux' && ready.edit === true && ready.editRevision === true;
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
        if (draft) draft.approvedUntil = performance.now() + 5 * 60_000;
        return 'Draft approved in memory. No file was written.';
      }
      if (command === '/recover') {
        let intent: Record<string, unknown>;
        try {
          const path = intentFile(arg);
          const contents = process.platform === 'linux'
            ? await readPrivateJournal(path, MAX_INTENT_BYTES) : await readFile(path, 'utf8');
          intent = JSON.parse(contents);
        }
        catch { return 'No readable edit intent for that recovery ID.'; }
        const files = intent?.version === 2 || intent?.version === 3 ? intent.files : [intent];
        if (intent?.root !== root || !Array.isArray(files) || !files.length ||
            files.length > MAX_DRAFT_FILES || !files.every(isIntentFile)) {
          return 'Recovery requires a valid intent for the selected project.';
        }
        const observations: string[] = [];
        for (const file of files) {
          if (signal.aborted) break;
          const { path, revision, before, after } = file;
          const observed = await invoke<{ content: string; revision?: string }>('read', {root, path}, signal);
          if (!observed.ok) {
            observations.push(`Recovery could not inspect the file ${quoteTerminal(path)}: ${quoteTerminal(observed.error.message)}`);
            continue;
          }
          const contents = digest(observed.value.content);
          const state = contents === after ? 'Matches the proposed replacement'
            : contents === before && observed.value.revision === revision ? 'Matches the original revision'
            : 'Does not match the original revision or proposed replacement';
          observations.push(`${state}: ${quoteTerminal(path)}`);
        }
        return [...observations, 'Current observations only. No edit was replayed.'].join('\n');
      }
      if (command === '/rollback') {
        draft = undefined;
        if (!host.editSupported) return 'This workspace host cannot apply rollbacks.';
        let files: RecoveryFile[];
        const receipts = new Map<string, string>();
        try {
          await assertPrivateAuditDirectory();
          const intent = JSON.parse(await readPrivateJournal(intentFile(arg), MAX_INTENT_BYTES));
          if (intent?.version !== 3 || intent.rollbackOf || intent.root !== root ||
              !Array.isArray(intent.files) || !intent.files.length || intent.files.length > MAX_DRAFT_FILES ||
              !intent.files.every(isIntentFile)) throw new Error('Invalid rollback intent');
          files = intent.files;
          for (const file of files) {
            if (typeof file.original !== 'string' || Buffer.byteLength(file.original) > MAX_EDIT_BYTES ||
                digest(file.original) !== file.before) throw new Error('Invalid rollback original');
          }
          const steps = await readPrivateJournal(intentFile(arg) + '.steps', 128_000);
          // A record without its final newline can be a torn append.
          for (const line of steps.split('\n').slice(0, -1)) {
            const step: EditStep = JSON.parse(line);
            if (step.phase === 'applied' && typeof step.path === 'string' && isRevision(step.revision)) {
              receipts.set(step.path, step.revision);
            }
          }
        } catch {
          return 'No readable rollback journal for that apply ID and selected project.';
        }

        const reverse: DraftFile[] = [];
        const preview: string[] = [];
        const skipped: string[] = [];
        for (const file of [...files].reverse()) {
          if (signal.aborted) return 'Rollback preview cancelled.';
          const label = quoteTerminal(file.path);
          const receipt = receipts.get(file.path);
          if (!receipt) {
            skipped.push(`Skipped ${label}: no confirmed write revision. Use /recover ${arg} to inspect it.`);
            continue;
          }
          const observed = await invoke<{ content: string; revision?: string }>('read', {root, path: file.path},
            signal, randomUUID(), `rollback:${arg}:${randomUUID()}`);
          if (!observed.ok) {
            skipped.push(`Skipped ${label}: ${quoteTerminal(observed.error.message)}`);
          } else if (digest(observed.value.content) === file.before) {
            skipped.push(`Skipped ${label}: original content is already present.`);
          } else if (observed.value.revision !== receipt || digest(observed.value.content) !== file.after) {
            skipped.push(`Skipped ${label}: conflict with the confirmed write revision.`);
          } else {
            reverse.push(Object.freeze({ path: file.path, before: observed.value.content, after: file.original!, revision: receipt }));
            preview.push(`Rollback for ${label}\n- ${quoteTerminal(observed.value.content)}\n+ ${quoteTerminal(file.original)}`);
          }
        }
        if (signal.aborted) return 'Rollback preview cancelled.';
        if (!reverse.length) return [...skipped, 'No files eligible for rollback.'].join('\n');
        draft = {
          files: Object.freeze(reverse),
          hash: digest(JSON.stringify({root, rollbackOf: arg, files: reverse})),
          rollbackOf: arg
        };
        return [`Rollback plan ${draft.hash} (${reverse.length} file(s)) for ${arg}.`, ...preview, ...skipped,
          'Use /approve for this rollback, then /apply. No file was written.'].join('\n');
      }
      if (command === '/apply') {
        if (arg) return 'Usage: /apply';
        const current = draft;
        const runId = randomUUID();
        try {
          const result = await invoke('apply-draft', null, signal, runId);
          return result.ok ? (current?.rollbackOf ? 'Rollback applied.' : 'Draft applied.') : `${quoteTerminal(result.error.message)} Inspect the file before preparing another draft.`;
        } finally {
          if (draft === current && current?.approvedUntil !== undefined) draft = undefined;
        }
      }
      if (command === '/draft') {
        draft = undefined;
        if (Buffer.byteLength(arg) > MAX_EDIT_BYTES) return 'Draft input exceeds 48 KB.';
        let input: unknown;
        try { input = JSON.parse(arg); }
        catch { return 'Usage: /draft {"path":"file","from":"old","to":"new"} or a JSON array of replacements'; }
        const changes = Array.isArray(input) ? input : [input];
        if (!changes.length || changes.length > MAX_DRAFT_FILES) return 'Drafts require between one and eight files.';
        const files: DraftFile[] = [];
        const preview: string[] = [];
        const paths = new Set<string>();
        const revisions = new Set<string>();
        for (const change of changes) {
          if (!change || typeof change !== 'object') return 'Invalid draft input.';
          const { path, from, to } = change as Record<string, unknown>;
          if (typeof path !== 'string' || typeof from !== 'string' || !from || typeof to !== 'string' || from === to) {
            return 'Specify a file and a nonempty, unique span to replace.';
          }
          if (paths.has(path)) return 'A draft cannot edit the same path twice.';
          paths.add(path);
          const result = await invoke<{ content: string; revision?: string }>('read', {root, path}, signal);
          if (!result.ok) return quoteTerminal(result.error.message);
          const { content: before, revision } = result.value;
          if (revision && revisions.has(revision)) return 'A draft cannot edit the same file through two paths.';
          if (revision) revisions.add(revision);
          const index = before.indexOf(from);
          if (index < 0 || index !== before.lastIndexOf(from)) return 'Draft span must occur exactly once.';
          const after = before.slice(0, index) + to + before.slice(index + from.length);
          if (Buffer.byteLength(after) > MAX_EDIT_BYTES) return 'Draft result exceeds 48 KB.';
          if (signal.aborted) return 'Draft cancelled.';
          files.push(Object.freeze({path, before, after, revision}));
          preview.push(`Draft for ${quoteTerminal(path)} (character offset ${index})\n- ${quoteTerminal(from)}\n+ ${quoteTerminal(to)}`);
        }
        draft = {files:Object.freeze(files), hash:digest(JSON.stringify({root,files}))};
        return [`Plan ${draft.hash} (${files.length} file(s)).`, ...preview,
          'Use /approve or /discard. No file was written.'].join('\n');
      }
      const operation = command === '/files' ? 'list' : command === '/read' ? 'read' : 'search';
      const input = operation === 'search' ? {root,path:'',query:arg} : {root,path:arg};
      const result = await invoke(operation, input, signal);
      return quoteTerminal(result.ok ? result.value : result.error.message);
    }
  };
}
