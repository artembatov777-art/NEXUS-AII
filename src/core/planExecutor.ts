import type { AgentPlanner, ValidatedPlan } from './agentPlanner';
import { captureExecutableToolRegistrations, isBoundExecutableToolStep, validateExecutablePlan } from './agentExecutionPolicy';
import type { AgentToolExecutor } from './agentToolBridge';
import type { AgentRunId } from './agents';
import { err, ok, type Result } from './result';
import type { ToolRegistry } from './toolRegistry';

export interface PlanStepResult { stepId: string; output: unknown }

/** Executes one validated plan sequentially through the existing tool gateway. */
export class PlanExecutor {
  constructor(private readonly planner: AgentPlanner, private readonly registry: ToolRegistry, private readonly executor: AgentToolExecutor) {}

  async run(goal: string, runId: string, signal: AbortSignal, onStep?: (step: PlanStepResult) => void): Promise<Result<PlanStepResult[]>> {
    if (!runId.trim() || runId.length > 120 || /[\u0000-\u001f\u007f]/.test(runId)) return err('validation', 'A valid run ID is required.');
    const tools = this.registry.search('', 200);
    if (!tools.ok) return tools;
    let plan: Result<ValidatedPlan>;
    try { plan = await this.planner.plan(goal, tools.value, signal); }
    catch {
      return signal.aborted
        ? err('cancelled', 'Planning was cancelled.')
        : err('provider_unavailable', 'Planner failed unexpectedly before execution.');
    }
    if (!plan.ok) return plan;
    return executeSequentialPlan(plan.value, runId, signal, this.registry, this.executor, onStep);
  }
}

/**
 * Host-neutral sequential execution of a known plan. The deterministic CLI
 * workspace planner and the model-backed CLI agent call the same security,
 * auditing and cancellation boundary; neither can bypass live registration
 * checks or send a forged tool input directly to the tool executor.
 *
 * Does not yet persist whole-plan checkpoints. The ToolGateway retains its
 * own durable per-step audit and will refuse ambiguous automatic replay.
 */
export async function executeSequentialPlan(
  plan: ValidatedPlan,
  runId: string,
  signal: AbortSignal,
  registry: ToolRegistry,
  executor: AgentToolExecutor,
  onStep?: (step: PlanStepResult) => void
): Promise<Result<PlanStepResult[]>> {
  if (typeof runId !== 'string' || !runId.trim() || runId.length > 120 ||
      /[\u0000-\u001f\u007f]/.test(runId)) {
    return err('validation', 'A valid run ID is required.');
  }
  if (signal.aborted) return err('cancelled', 'Agent run was cancelled.');
  const checked = validateExecutablePlan(plan, registry);
  if (!checked.ok) return checked;
  const bindings = captureExecutableToolRegistrations(checked.value, registry);
  if (!bindings.ok) return bindings;

  const results: PlanStepResult[] = [];
  for (const [index, step] of checked.value.steps.entries()) {
    if (signal.aborted) return err('cancelled', 'Agent run was cancelled.');
    if (!isBoundExecutableToolStep(step.toolId, registry, bindings.value)) {
      return err('validation', 'Planned tool registration changed; inspect the audit and create a new plan.');
    }
    let result: Result<unknown>;
    try {
      result = await executor.execute(step.toolId, step.input, {
        runId: runId as AgentRunId, step: index + 1, signal
      });
    } catch {
      return err('tool_failed', 'Tool adapter failed unexpectedly. The outcome may be unknown; inspect audit before retrying.');
    }
    if (signal.aborted) {
      return err('cancelled', 'Agent run was cancelled; a dispatched tool may already have acted. Inspect audit before retrying.');
    }
    if (!result.ok) return result;
    const completed = { stepId: step.id, output: result.value };
    results.push(completed);
    try { onStep?.(completed); }
    catch {
      return err('internal', 'Tool step completed, but its progress observer failed. Inspect the audit before retrying.');
    }
  }
  return ok(results);
}
