import type { AgentPlanner, ValidatedPlan } from './agentPlanner';
import { isExecutableToolStep, validateExecutablePlan } from './agentExecutionPolicy';
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
    // The planner validates a candidate plan, but the tool catalog may have
    // changed while planning. Both CLI and Desktop enforce the same execution
    // policy against the live host registry, not the model's tool list.
    const checked = validateExecutablePlan(plan.value, this.registry);
    if (!checked.ok) return checked;
    const results: PlanStepResult[] = [];
    for (const [index, step] of checked.value.steps.entries()) {
      if (signal.aborted) return err('cancelled', 'Agent run was cancelled.');
      if (!isExecutableToolStep(step.toolId, this.registry)) {
        return err('validation', 'Planned tool is no longer registered.');
      }
      let result: Result<unknown>;
      try {
        result = await this.executor.execute(step.toolId, step.input, { runId: runId as AgentRunId, step: index + 1, signal });
      } catch {
        return err('tool_failed', 'Tool adapter failed unexpectedly. The outcome may be unknown; inspect audit before retrying.');
      }
      // A non-cooperating adapter may return a successful response after its
      // signal was aborted. Never report that run as successfully completed.
      if (signal.aborted) return err('cancelled', 'Agent run was cancelled; a dispatched tool may already have acted. Inspect audit before retrying.');
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
}
