import type { AgentId, AgentRunId } from './agents';
import type { AgentPlanner, ValidatedPlan } from './agentPlanner';
import type { MultiAgentCoordinator } from './multiAgentCoordinator';
import type { ToolRegistry } from './toolRegistry';
import { err, type Result } from './result';

/** Host-neutral workflow; the host supplies the checkpointed coordinator and tool registry. */
export function createAgentWorkflow(planner: AgentPlanner, registry: ToolRegistry, coordinator: MultiAgentCoordinator, agentId: AgentId, allowedToolIds?: readonly string[]) {
  const allowed = allowedToolIds ? new Set(allowedToolIds) : null;
  return {
    plan: async (goal: string, signal: AbortSignal, referenceContext?: string): Promise<Result<ValidatedPlan>> => {
      const available = registry.search('', 100);
      if (!available.ok) return available;
      const tools = allowed ? available.value.filter(tool => allowed.has(tool.id) || (allowed.has('mcp.*') && tool.id.startsWith('mcp.'))) : available.value;
      if (allowed && tools.length === 0) return err('validation', 'No tools allowed for this workflow are registered.');
      return planner.plan(goal, tools, signal, referenceContext);
    },
    run: (plan: ValidatedPlan, runId: AgentRunId, signal: AbortSignal) => {
      const assignments = Object.fromEntries(plan.steps.map(step => [step.id, agentId])) as Record<string, AgentId>;
      return coordinator.run(runId, plan, assignments, signal);
    },
    resume: (runId: AgentRunId, signal: AbortSignal) => coordinator.resume(runId, signal)
  };
}
