import { randomUUID } from 'node:crypto';
import { AgentPlanner, type AgentPlanStep } from '../src/core/agentPlanner';
import type { AgentToolExecutor } from '../src/core/agentToolBridge';
import { PlanExecutor, type PlanStepResult } from '../src/core/planExecutor';
import { err, ok, type Result } from '../src/core/result';
import type { ToolRegistry } from '../src/core/toolRegistry';
import { quoteTerminal } from './quote';
import { digest } from './workspaceRecovery';
import { MAX_EDIT_BYTES, parseReplacements, prepareChanges as preparePreview, type Replacement, type WorkspaceSnapshot } from '../src/core/workspaceChangePreview';
export { parseReplacements, type DraftFile, type WorkspaceSnapshot } from '../src/core/workspaceChangePreview';

interface Task {
  goal: string;
  directory: string;
  query?: string;
  changes: readonly Replacement[];
}

export interface WorkspaceTaskPlan {
  readonly id: string;
  readonly goal: string;
  readonly hash: string;
  readonly directory: string;
  readonly query?: string;
  readonly entries: readonly string[];
  readonly candidates: readonly string[];
  readonly risks: readonly string[];
  readonly actions: readonly {
    path: string;
    action: 'replace exact span';
    revision: string | null;
    originalContentHash: string;
    expectedContentHash: string;
  }[];
  readonly expectedResult: string;
}

export async function prepareChanges(changes: readonly Replacement[], read: (path: string) => Promise<Result<WorkspaceSnapshot>>, signal: AbortSignal) {
  const result = await preparePreview(changes, read, signal);
  if (!result.ok) return result;
  const { files, spans } = result.value;
  const diff = spans.map(({ path, from, to, offset }) =>
    `Draft for ${quoteTerminal(path)} (character offset ${offset})\n- ${quoteTerminal(from)}\n+ ${quoteTerminal(to)}`);
  return ok({ files, diff: Object.freeze(diff) });
}

function parseTask(input: string): Result<Task> {
  if (Buffer.byteLength(input) > MAX_EDIT_BYTES) return err('validation', 'Plan input exceeds 48 KB.');
  if (!input.startsWith('{')) {
    if (!input || input.length > 4000) return err('validation', 'Usage: /agent plan <goal> or /agent plan {"goal":"...","changes":[...]}');
    return ok({ goal: input, directory: '', query: Buffer.byteLength(input) <= 256 ? input : undefined, changes: [] });
  }
  let value: Record<string, unknown>;
  try { value = JSON.parse(input); }
  catch { return err('validation', 'The structured plan must be valid JSON.'); }
  const { goal, directory = '', query, changes } = value;
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 4000 ||
      typeof directory !== 'string' ||
      (query !== undefined && (typeof query !== 'string' || !query.trim() || Buffer.byteLength(query) > 256)) ||
      Object.keys(value).some(key => !['goal', 'directory', 'query', 'changes'].includes(key))) {
    return err('validation', 'Provide a goal, an optional relative directory, and an optional literal query of up to 256 bytes.');
  }
  if (changes !== undefined && !Array.isArray(changes)) return err('validation', 'Plan changes must be an array of replacements.');
  const parsed = changes?.length ? parseReplacements(changes) : ok([]);
  return parsed.ok ? ok({ goal: goal.trim(), directory, query, changes: parsed.value }) : parsed;
}

function workspaceStep(root: string, operation: 'list' | 'search' | 'read', path: string, query?: string): AgentPlanStep {
  // JSON plans cannot contain undefined values. Omit optional query for read/list
  // rather than weakening the shared Agent Engine's strict input boundary.
  const input = query === undefined ? { root, path } : { root, path, query };
  return { id: operation, toolId: `cli.workspace.${operation}`, purpose: `Workspace ${operation}`, input, dependsOn: [] };
}

function entries(output: unknown): string[] {
  const values = (output as { entries?: unknown } | undefined)?.entries;
  return Array.isArray(values) ? values.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Deterministic workspace analysis. User-supplied exact replacements are the only source of edits. */
export class WorkspacePlanner {
  constructor(private readonly registry: ToolRegistry, private readonly tools: AgentToolExecutor) {}

  private executor(createSteps: (goal: string) => Result<AgentPlanStep[]>) {
    const planner = new AgentPlanner({
      async createPlan({ goal }) {
        const steps = createSteps(goal);
        return steps.ok ? ok({ goal, steps: steps.value }) : steps;
      }
    }, 2);
    return new PlanExecutor(planner, this.registry, this.tools);
  }

  runInspection(root: string, goal: string, runId: string, signal: AbortSignal, onStep?: (step: PlanStepResult) => void) {
    return this.executor(task => {
      const match = /^(read|list|search)(?:[ \t]+(.+))?$/.exec(task);
      if (!match || (!match[2] && match[1] !== 'list')) {
        return err('validation', 'Offline tasks: read <file>, list [directory], search <text>.');
      }
      const [, operation, arg = ''] = match;
      if (operation === 'search') return ok([workspaceStep(root, 'search', '', arg)]);
      return ok([workspaceStep(root, operation === 'list' ? 'list' : 'read', arg)]);
    }).run(goal, runId, signal, onStep);
  }

  async plan(root: string, input: string, read: (path: string, planId: string) => Promise<Result<WorkspaceSnapshot>>, signal: AbortSignal) {
    const parsed = parseTask(input);
    if (!parsed.ok) return parsed;
    const { goal, directory, query, changes } = parsed.value;
    const id = randomUUID();
    const steps = [workspaceStep(root, 'list', directory)];
    if (query) steps.push(workspaceStep(root, 'search', directory, query));
    const discovery = await this.executor(() => ok(steps)).run(goal, id, signal);
    if (!discovery.ok) return discovery;

    const prepared = await prepareChanges(changes, path => read(path, id), signal);
    if (!prepared.ok) return prepared;
    const { files, diff } = prepared.value;
    const risks = ['Directory and literal search results are bounded.'];
    if (files.length) {
      risks.push('Every target must still match its captured snapshot at approval and apply.');
      if (files.length > 1) risks.push('File replacements are sequential. A later failure can leave earlier replacements applied.');
      if (files.some(file => !file.revision)) risks.push('The selected host did not supply every write revision.');
    }
    const plan = {
      id, goal, directory, query,
      entries: Object.freeze(entries(discovery.value[0].output)),
      candidates: Object.freeze(entries(discovery.value[1]?.output)),
      risks: Object.freeze(risks),
      actions: Object.freeze(files.map(file => Object.freeze({
        path: file.path, action: 'replace exact span' as const, revision: file.revision ?? null,
        originalContentHash: digest(file.before), expectedContentHash: digest(file.after)
      }))),
      expectedResult: files.length ? 'Apply the supplied exact replacements after explicit approval.' : 'Report project structure and literal search candidates.'
    };
    const hash = digest(JSON.stringify({ root, plan }));
    return ok({ plan: Object.freeze({ ...plan, hash }), files, diff });
  }
}
