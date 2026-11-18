import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join } from 'node:path';
import { mkdir, open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { ok, err } from '../src/core/result';
import { ToolGateway, type PermissionService, type ToolAuditEvent } from '../src/core/tools';
import { registerCliWorkspaceTools } from './workspace';
import { GatewayAgentToolExecutor } from '../src/core/agentToolBridge';
import type { PlanStepResult } from '../src/core/planExecutor';
import { ToolRegistry } from '../src/core/toolRegistry';
import { quoteTerminal } from './quote';
import {
  assertPrivateDirectory, assertPrivateJournal, digest, isIntentFile, isRecoveryId, MAX_DRAFT_FILES, MAX_EDIT_BYTES,
  MAX_INTENT_BYTES, MAX_STEPS_BYTES, parseEditEvidence, readInspectionJournal, readPrivateJournal,
  syncDirectory, WorkspaceRecoveryStore, type EditEvidence, type RecoveryFile
} from './workspaceRecovery';
import {
  parseReplacements, prepareChanges, WorkspacePlanner, type DraftFile, type WorkspaceSnapshot, type WorkspaceTaskPlan
} from './workspacePlanner';

const executable = fileURLToPath(new URL('./bin/nexus-workspace' + (process.platform === 'win32' ? '.exe' : ''), import.meta.url));

class Connection {
  editSupported = false;
  private stopped = false;
  private child;
  private chunks;
  constructor(root: string) {
    this.child = spawn(executable, [root], { shell: false, stdio: ['pipe','pipe','ignore'], windowsHide: true });
    this.chunks = this.child.stdout[Symbol.asyncIterator]();
    this.child.on('error', () => this.close());
    this.child.on('exit', () => { this.stopped = true; });
    this.child.stdin.on('error', () => this.close());
  }
  get connected() { return !this.stopped; }
  close() {
    if (!this.stopped) {
      this.stopped = true;
      this.child.kill('SIGKILL');
    }
    this.child.stdout.destroy();
  }
  async exchange(request: unknown, signal: AbortSignal) {
    if (!this.connected) throw new Error('Workspace host disconnected. Select the project again.');
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

interface EditStep {
  phase: string;
  path?: string;
  revision?: string;
}

interface DraftPlan {
  readonly files: readonly DraftFile[];
  readonly hash: string;
  readonly rollbackOf?: string;
  readonly agentPlanId?: string;
  readonly agentDiff?: readonly string[];
  previewed?: boolean;
  approvedUntil?: number;
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && /^\d+:\d+:-?\d+:\d+:\d+$/.test(value);
}

export function workspaceSession(permissions: PermissionService, report: (text: string) => void) {
  let host: Connection | undefined;
  let root = '';
  let draft: DraftPlan | undefined;
  let planned: WorkspaceTaskPlan | undefined;
  let lastAttempt: {
    id: string; kind: string; hash: string; confirmed: number; total: number; result: 'incomplete' | 'completed';
  } | undefined;
  const dir = join(homedir(), '.nexus-au', 'workspace-audit');
  const recovery = new WorkspaceRecoveryStore(join(dirname(dir), 'workspace-recovery'));
  const auditFile = (id: string) => {
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error('Invalid audit run identifier');
    return join(dir, id + '.jsonl');
  };
  const intentFile = (id: string) => {
    if (!isRecoveryId(id)) throw new Error('Invalid recovery ID');
    return join(dir, id + '.edit.json');
  };
  async function assertPrivateAuditDirectory() {
    await assertPrivateDirectory(dirname(dir));
    await assertPrivateDirectory(dir);
  }

  async function readIntent(id: string) {
    const contents = await readInspectionJournal(intentFile(id), MAX_INTENT_BYTES);
    const intent = JSON.parse(contents);
    if (intent?.version === 4) {
      const { root, plan, planId, rollbackOf, files, recoveryHash } = intent;
      const manifest = { root, plan, planId, rollbackOf, files };
      if (digest(JSON.stringify({ id, manifest, recoveryHash })) !== intent.intentHash) {
        throw new Error('Invalid edit intent checksum');
      }
    }
    return intent;
  }

  async function syncAuditDirectory() {
    for (const path of [dir, dirname(dir), homedir()]) await syncDirectory(path);
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
      if (!host.connected) return err('tool_failed', 'Workspace host disconnected. Select the project again.');
      const reply = await host.exchange({version:1,operation,path,query},signal);
      if (reply.ok === true) return ok(reply.value);
      if (reply.ok === false && typeof reply.message === 'string') return err('tool_failed',reply.message);
      return err('tool_failed','Invalid workspace backend response.');
    }
  });
  const resource = (plan: DraftPlan) => plan.files.length === 1 && !plan.rollbackOf && !plan.agentDiff
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
      await assertPrivateJournal(file, MAX_STEPS_BYTES);
      const step = { ...event, at: new Date().toISOString() };
      const checksum = digest(JSON.stringify({ runId, step }));
      await file.appendFile(JSON.stringify({ ...step, checksum }) + '\n');
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
      if (draft?.agentDiff && !draft.previewed) return err('validation', 'View the complete plan diff with /agent diff before approval.');
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

      const manifest = {
        root: input.root,
        plan: input.draft.hash,
        planId: input.draft.agentPlanId,
        rollbackOf: input.draft.rollbackOf,
        files: input.draft.files.map(({ path, revision, before, after }) =>
          ({ path, revision: revision!, before: digest(before), after: digest(after) }))
      };
      const id = context.runId;
      try {
        await assertPrivateAuditDirectory();
        const recoveryHash = await recovery.save(id, manifest, input.draft.files.map(file => file.before));
        const journal = await open(intentFile(id), 'wx', 0o600);
        try {
          const intentHash = digest(JSON.stringify({ id, manifest, recoveryHash }));
          await journal.writeFile(JSON.stringify({ version: 4, ...manifest, recoveryHash, intentHash }));
          await journal.sync();
        } finally { await journal.close(); }
        await syncAuditDirectory();
        await recordEditStep(id, { phase: 'preflight-started' });
      } catch {
        return err('storage_failed', 'Cannot persist edit intent. No edit was dispatched.');
      }
      if (!current()) return err('cancelled', 'Operation stopped before preflight. No edits were dispatched.');
      const label = input.draft.rollbackOf ? 'Rollback' : 'Apply';
      const attempt = { id, kind: label, hash: input.draft.hash, confirmed: 0, total: input.draft.files.length, result: 'incomplete' as const };
      lastAttempt = attempt;
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

      const progress = () => `${attempt.confirmed}/${attempt.total} file(s) confirmed. Use /recover ${id} to inspect every file.`;
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
          attempt.confirmed++;
        } catch {
          // The last write may have passed rename even if IPC or journaling
          // failed. Do not replay or compensate automatically.
          return err('tool_failed', `Write or journal interrupted. The edit outcome is unknown. ${progress()}`);
        }
      }
      return ok({ applied: attempt.confirmed });
    }
  });
  if (!apply.ok) throw new Error(apply.error.message);

  const invoke = <T = unknown>(operation: string, input: unknown, signal: AbortSignal,
    runId = randomUUID(), traceId: string = randomUUID()) =>
    gateway.execute<T>(`cli.workspace.${operation}`, input, {runId, traceId, signal}, 'owner');

  const planner = new WorkspacePlanner(registry, new GatewayAgentToolExecutor(gateway, 'owner'));
  const readSnapshot = (path: string, signal: AbortSignal, planId?: string) =>
    invoke<WorkspaceSnapshot>('read', { root, path }, signal, randomUUID(), planId ? `plan:${planId}:${randomUUID()}` : undefined);

  function inspect(plan: WorkspaceTaskPlan) {
    return [
      `Agent plan ${plan.id} (hash ${plan.hash})`,
      `Goal: ${quoteTerminal(plan.goal)}`,
      `Analyzed directory: ${quoteTerminal(plan.directory || '.')}`,
      `Entries: ${quoteTerminal(plan.entries)}`,
      ...(plan.query ? [`Candidates for ${quoteTerminal(plan.query)}: ${quoteTerminal(plan.candidates)}`] : []),
      `Proposed actions: ${plan.actions.length}`,
      ...plan.actions.map(action => `- ${quoteTerminal(action)}`),
      `Expected result: ${plan.expectedResult}`,
      ...plan.risks.map(risk => `Risk: ${risk}`)
    ].join('\n');
  }

  return {
    run: (goal: string, runId: string, signal: AbortSignal, onStep?: (step: PlanStepResult) => void) =>
      host ? planner.runInspection(root, goal, runId, signal, onStep)
        : Promise.resolve(err('permission_denied', 'Select a project first.')),
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
        if (root !== arg) lastAttempt = undefined;
        host?.close(); host=next; root=arg; draft=undefined; planned=undefined;
        return 'Selected '+quoteTerminal(root);
      }
      if (!host) return 'No project selected. Use /project <absolute directory>.';
      if (command === '/agent') {
        const [action] = arg.split(/\s/, 1);
        const parameters = arg.slice(action.length).trim();
        if (action === 'plan') {
          draft = undefined;
          planned = undefined;
          const result = await planner.plan(root, parameters, (path, id) => readSnapshot(path, signal, id), signal);
          if (!result.ok) return `Planning stopped: ${quoteTerminal(result.error.message)}`;
          const { plan, files, diff } = result.value;
          planned = plan;
          if (files.length) draft = { files, hash: plan.hash, agentPlanId: plan.id, agentDiff: diff };
          return [
            'Deterministic workspace planner (no AI provider).',
            inspect(plan),
            files.length ? 'Use /agent diff to review the plan before approval.' : 'Read-only plan. Supply explicit replacements to prepare a diff.'
          ].join('\n');
        }
        if (parameters) return `Usage: /agent ${action}`;
        if (action === 'inspect') return planned ? inspect(planned) : 'No current agent plan.';
        if (action === 'diff') {
          if (!draft?.agentDiff) return 'No pending agent changes.';
          draft.previewed = true;
          return [`Diff for agent plan ${draft.hash}`, ...draft.agentDiff,
            'Use /approve or /discard. No file was written.'].join('\n');
        }
        if (action === 'status') {
          let state = planned ? 'Read-only analysis complete.' : 'No pending plan.';
          if (planned?.actions.length) state = 'Plan is no longer pending.';
          if (draft) {
            state = draft.approvedUntil !== undefined
              ? (performance.now() < draft.approvedUntil ? 'Approved for one apply attempt.' : 'Approval expired. Prepare a new plan.')
              : (draft.agentDiff && !draft.previewed ? 'Review /agent diff before approval.' : 'Awaiting approval.');
          }
          return [
            `Status: ${state}`,
            `Workspace host: ${!host.connected ? 'disconnected; reselect the project' : host.editSupported ? 'connected' : 'connected (read-only)'}.`,
            ...(planned ? [`Agent plan ${planned.id} (hash ${planned.hash})`] : []),
            ...(lastAttempt ? [
              `${lastAttempt.kind} attempt ${lastAttempt.id} for plan ${lastAttempt.hash}: ${lastAttempt.result}. ${lastAttempt.confirmed}/${lastAttempt.total} file(s) confirmed.`,
              `Use /recover ${lastAttempt.id} to inspect each file.`
            ] : [])
          ].join('\n');
        }
        return 'Usage: /agent plan <task>, /agent inspect, /agent diff, or /agent status';
      }
      if (command === '/discard') {
        draft = undefined;
        planned = undefined;
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
        try { intent = await readIntent(arg); }
        catch { return 'No readable edit intent for that recovery ID.'; }
        const files = intent && [2, 3, 4].includes(intent.version as number) ? intent.files : [intent];
        if (intent?.root !== root || !Array.isArray(files) || !files.length ||
            files.length > MAX_DRAFT_FILES || !files.every(isIntentFile)) {
          return 'Recovery requires a valid intent for the selected project.';
        }
        let evidence: Map<string, EditEvidence> | undefined;
        if (intent.version === 3 || intent.version === 4) {
          try {
            const steps = await readInspectionJournal(intentFile(arg) + '.steps', MAX_STEPS_BYTES, true);
            evidence = parseEditEvidence(steps, arg, intent.version, files);
          } catch { /* Current bytes can still be inspected without a journal. */ }
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
          const step = evidence?.get(path);
          const receipt = step?.phase === 'applied'
            ? (observed.value.revision === step.revision && contents === after ? 'confirmed revision' : 'confirmed revision has since changed')
            : step ? 'dispatch recorded; outcome unconfirmed'
              : evidence ? 'no dispatch recorded' : 'write evidence unavailable';
          observations.push(`${state}: ${quoteTerminal(path)} (journal: ${receipt})`);
        }
        return [...observations, 'Current observations only. No edit was replayed.'].join('\n');
      }
      if (command === '/rollback') {
        draft = undefined;
        planned = undefined;
        if (!host.editSupported) return 'This workspace host cannot apply rollbacks.';
        let files: RecoveryFile[];
        let originals: readonly string[];
        let receipts: Map<string, EditEvidence>;
        try {
          await assertPrivateAuditDirectory();
          const intent = await readIntent(arg);
          if (![3, 4].includes(intent?.version) || intent.rollbackOf || intent.root !== root ||
              !Array.isArray(intent.files) || !intent.files.length || intent.files.length > MAX_DRAFT_FILES ||
              !intent.files.every(isIntentFile)) throw new Error('Invalid rollback intent');
          files = intent.files;
          if (intent.version === 4) {
            const { root, plan, planId, rollbackOf } = intent;
            try {
              originals = await recovery.load(arg, { root, plan, planId, rollbackOf, files }, intent.recoveryHash);
            } catch {
              return 'Recovery data is missing or failed integrity verification. Use /recover to inspect the files.';
            }
          } else {
            originals = files.map(file => {
              if (typeof file.original !== 'string' || Buffer.byteLength(file.original) > MAX_EDIT_BYTES ||
                  digest(file.original) !== file.before) throw new Error('Invalid rollback original');
              return file.original;
            });
          }
          const steps = await readPrivateJournal(intentFile(arg) + '.steps', MAX_STEPS_BYTES, true);
          receipts = parseEditEvidence(steps, arg, intent.version, files);
        } catch {
          return 'No readable rollback journal for that apply ID and selected project.';
        }

        const reverse: DraftFile[] = [];
        const preview: string[] = [];
        const skipped: string[] = [];
        for (const [index, file] of [...files.entries()].reverse()) {
          if (signal.aborted) return 'Rollback preview cancelled.';
          const label = quoteTerminal(file.path);
          const step = receipts.get(file.path);
          if (step?.phase !== 'applied') {
            skipped.push(`Skipped ${label}: no confirmed write revision. Use /recover ${arg} to inspect it.`);
            continue;
          }
          const receipt = step.revision;
          const observed = await invoke<{ content: string; revision?: string }>('read', {root, path: file.path},
            signal, randomUUID(), `rollback:${arg}:${randomUUID()}`);
          if (!observed.ok) {
            skipped.push(`Skipped ${label}: ${quoteTerminal(observed.error.message)}`);
          } else if (digest(observed.value.content) === file.before) {
            skipped.push(`Skipped ${label}: original content is already present.`);
          } else if (observed.value.revision !== receipt || digest(observed.value.content) !== file.after) {
            skipped.push(`Skipped ${label}: conflict with the confirmed write revision.`);
          } else {
            reverse.push(Object.freeze({ path: file.path, before: observed.value.content, after: originals[index], revision: receipt }));
            preview.push(`Rollback for ${label}\n- ${quoteTerminal(observed.value.content)}\n+ ${quoteTerminal(originals[index])}`);
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
          if (result.ok && lastAttempt?.id === runId) lastAttempt.result = 'completed';
          return result.ok ? (current?.rollbackOf ? 'Rollback applied.' : 'Draft applied.') : `${quoteTerminal(result.error.message)} Inspect the file before preparing another draft.`;
        } finally {
          if (draft === current && current?.approvedUntil !== undefined) draft = undefined;
        }
      }
      if (command === '/draft') {
        draft = undefined;
        planned = undefined;
        if (Buffer.byteLength(arg) > MAX_EDIT_BYTES) return 'Draft input exceeds 48 KB.';
        let input: unknown;
        try { input = JSON.parse(arg); }
        catch { return 'Usage: /draft {"path":"file","from":"old","to":"new"} or a JSON array of replacements'; }
        const changes = parseReplacements(input);
        if (!changes.ok) return quoteTerminal(changes.error.message);
        const prepared = await prepareChanges(changes.value, path => readSnapshot(path, signal), signal);
        if (!prepared.ok) return quoteTerminal(prepared.error.message);
        const { files, diff } = prepared.value;
        draft = {files, hash:digest(JSON.stringify({root,files}))};
        return [`Plan ${draft.hash} (${files.length} file(s)).`, ...diff,
          'Use /approve or /discard. No file was written.'].join('\n');
      }
      const operation = command === '/files' ? 'list' : command === '/read' ? 'read' : 'search';
      const input = operation === 'search' ? {root,path:'',query:arg} : {root,path:arg};
      const result = await invoke(operation, input, signal);
      return quoteTerminal(result.ok ? result.value : result.error.message);
    }
  };
}
