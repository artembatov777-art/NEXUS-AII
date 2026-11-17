import type { AgentPlanner } from './agentPlanner';
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
    const plan = await this.planner.plan(goal, tools.value, signal);
    if (!plan.ok) return plan;
    if (plan.value.steps.length === 0) return err('validation', 'The agent plan contains no executable steps.');
    const results: PlanStepResult[] = [];
    for (const [index, step] of plan.value.steps.entries()) {
      if (signal.aborted) return err('cancelled', 'Agent run was cancelled.');
      const result = await this.executor.execute(step.toolId, step.input, { runId: runId as AgentRunId, step: index + 1, signal });
      if (!result.ok) return result;
      const completed = { stepId: step.id, output: result.value };
      results.push(completed);
      onStep?.(completed);
    }
    return ok(results);
  }
}
