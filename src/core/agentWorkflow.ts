import type { AgentId, AgentRunId } from './agents';
import type { AgentPlanner, ValidatedPlan } from './agentPlanner';
import { isExecutableToolStep, validateExecutablePlan } from './agentExecutionPolicy';
import type { MultiAgentCoordinator, CoordinationEvent } from './multiAgentCoordinator';
import type { ToolRegistry } from './toolRegistry';
import { err, type Result } from './result';

/** Host-neutral workflow; the host supplies the checkpointed coordinator and tool registry. */
export function createAgentWorkflow(planner: AgentPlanner, registry: ToolRegistry, coordinator: MultiAgentCoordinator, agentId: AgentId, allowedToolIds?: readonly string[]) {
  const grantedTools = allowedToolIds ? [...allowedToolIds] : undefined;
  const allowed = grantedTools ? new Set(grantedTools) : null;
  return {
    plan: async (goal: string, signal: AbortSignal, referenceContext?: string): Promise<Result<ValidatedPlan>> => {
      const available = registry.search('', 100);
      if (!available.ok) return available;
      const tools = allowed ? available.value.filter(tool => allowed.has(tool.id) || (allowed.has('mcp.*') && tool.id.startsWith('mcp.'))) : available.value;
      if (allowed && tools.length === 0) return err('validation', 'No tools allowed for this workflow are registered.');
      return planner.plan(goal, tools, signal, referenceContext);
    },
    run: async function* (plan: ValidatedPlan, runId: AgentRunId, signal: AbortSignal): AsyncIterable<CoordinationEvent> {
      if (signal.aborted) {
        yield { type: "failed", runId, detail: "Agent workflow was cancelled before execution." };
        return;
      }
      // A planner's earlier filtered catalog is not a durable permission grant.
      // Revalidate the exact plan at the dispatch boundary, then recheck the
      // live registry before every delegated step and after approval pauses.
      const checked = validateExecutablePlan(plan, registry, grantedTools);
      if (!checked.ok) {
        yield { type: "failed", runId, detail: checked.error.message };
        return;
      }
      const assignments = Object.fromEntries(checked.value.steps.map(step => [step.id, agentId])) as Record<string, AgentId>;
      yield* coordinator.run(runId, checked.value, assignments, signal,
        step => isExecutableToolStep(step.toolId, registry, grantedTools));
    },
    resume: (runId: AgentRunId, signal: AbortSignal) => coordinator.resume(runId, signal)
  };
}
