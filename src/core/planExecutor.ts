import type { AgentPlanner, ValidatedPlan } from './agentPlanner';
import { captureExecutableToolRegistrations, isBoundExecutableToolStep, validateExecutablePlan } from './agentExecutionPolicy';
import type { AgentToolExecutor } from './agentToolBridge';
import type { AgentRunId } from './agents';
import { err, ok, type Result } from './result';
import type { ToolRegistry } from './toolRegistry';
import { PlanRunCheckpointService, type PlanRunCheckpointSession } from './planRunCheckpoints';

export interface PlanStepResult { stepId: string; output: unknown }

/** Executes one validated plan sequentially through the existing tool gateway. */
export class PlanExecutor {
  constructor(private readonly planner: AgentPlanner, private readonly registry: ToolRegistry,
    private readonly executor: AgentToolExecutor, private readonly checkpoints?: PlanRunCheckpointService) {}

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
    return executeSequentialPlan(plan.value, runId, signal, this.registry, this.executor, onStep, this.checkpoints);
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
  onStep?: (step: PlanStepResult) => void,
  checkpoints?: PlanRunCheckpointService
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

  // The optional host adapter uses the existing Desktop-compatible checkpoint
  // contract. Without it, the Gateway audit still protects the current CLI.
  let checkpoint: PlanRunCheckpointSession | undefined;
  if (checkpoints) {
    const started = await checkpoints.begin(runId, checked.value);
    if (!started.ok) return started;
    checkpoint = started.value;
  }
  const stop = async (failure: Result<PlanStepResult[]>, status: "failed" | "cancelled"):
    Promise<Result<PlanStepResult[]>> => {
    if (!checkpoint) return failure;
    const saved = await checkpoint.interrupt(status);
    if (!saved.ok) return err("storage_failed",
      "Could not durably record the interrupted plan; inspect the checkpoint and tool audit before retrying.");
    return failure;
  };

  const results: PlanStepResult[] = [];
  for (const [index, step] of checked.value.steps.entries()) {
    if (signal.aborted) return stop(err('cancelled', 'Agent run was cancelled.'), "cancelled");
    if (!isBoundExecutableToolStep(step.toolId, registry, bindings.value)) {
      return stop(err('validation', 'Planned tool registration changed; inspect the audit and create a new plan.'), "failed");
    }
    // Persist dispatch intent BEFORE handing control to any tool adapter.
    // A process crash from here to the confirmed return is an ambiguous
    // external outcome; no restart is permitted to replay this step blindly.
    if (checkpoint) {
      const prepared = await checkpoint.beforeStep(index, step.id, step.toolId);
      if (!prepared.ok) return err("storage_failed",
        "Could not persist tool dispatch intent. No tool was invoked; inspect the checkpoint before retrying.");
    }
    let result: Result<unknown>;
    try {
      result = await executor.execute(step.toolId, step.input, {
        runId: runId as AgentRunId, step: index + 1, signal
      });
    } catch {
      return stop(err('tool_failed', 'Tool adapter failed unexpectedly. The outcome may be unknown; inspect audit before retrying.'), "failed");
    }
    if (signal.aborted) {
      return stop(err('cancelled', 'Agent run was cancelled; a dispatched tool may already have acted. Inspect audit before retrying.'), "cancelled");
    }
    if (!result.ok) return stop(result, "failed");
    if (checkpoint) {
      // A successful return alone is not a durable completion receipt.
      const persisted = await checkpoint.afterStep(index);
      if (!persisted.ok) return err("storage_failed",
        "Tool may have completed but its checkpoint could not be confirmed. Inspect audit and checkpoint before retrying.");
    }
    const completed = { stepId: step.id, output: result.value };
    results.push(completed);
    try { onStep?.(completed); }
    catch {
      return stop(err('internal', 'Tool step completed, but its progress observer failed. Inspect the audit before retrying.'), "failed");
    }
  }
  if (checkpoint) {
    const finished = await checkpoint.complete();
    if (!finished.ok) return err("storage_failed",
      "All tools returned, but the final plan checkpoint could not be confirmed. Inspect before retrying.");
  }
  return ok(results);
}
