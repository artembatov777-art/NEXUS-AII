import type { AgentId, AgentRunId } from './agents';
import type { AgentPlanner, ValidatedPlan } from './agentPlanner';
import { captureExecutableToolRegistrations, isBoundExecutableToolStep, isExecutableToolStep, validateExecutablePlan } from './agentExecutionPolicy';
import type { MultiAgentCoordinator, CoordinationEvent } from './multiAgentCoordinator';
import type { ToolRegistry } from './toolRegistry';
import { err, type Result } from './result';

/** Host-neutral workflow; the host supplies the checkpointed coordinator and tool registry. */
export function createAgentWorkflow(planner: AgentPlanner, registry: ToolRegistry, coordinator: MultiAgentCoordinator, agentId: AgentId, allowedToolIds?: readonly string[]) {
  const grantedTools = allowedToolIds ? [...allowedToolIds] : undefined;
  const allowed = grantedTools ? new Set(grantedTools) : null;
  // The original owner list may narrow during approval. Never widen the
  // admission-time snapshot, but honor live revocations on each delegation.
  const permittedNow = (toolId: string) =>
    isExecutableToolStep(toolId, registry, grantedTools) &&
    isExecutableToolStep(toolId, registry, allowedToolIds);
  return {
    plan: async (goal: string, signal: AbortSignal, referenceContext?: string): Promise<Result<ValidatedPlan>> => {
      const available = registry.search('', 100);
      if (!available.ok) return available;
      const tools = allowed ? available.value.filter(tool =>
        (allowed.has(tool.id) || (allowed.has('mcp.*') && tool.id.startsWith('mcp.'))) && permittedNow(tool.id)) : available.value;
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
      if (!checked.value.steps.every(step => permittedNow(step.toolId))) {
        yield { type: "failed", runId, detail: "A planned tool has been revoked by the owner." };
        return;
      }
      const bindings = captureExecutableToolRegistrations(checked.value, registry, grantedTools);
      if (!bindings.ok) {
        yield { type: "failed", runId, detail: bindings.error.message };
        return;
      }
      const assignments = Object.fromEntries(checked.value.steps.map(step => [step.id, agentId])) as Record<string, AgentId>;
      yield* coordinator.run(runId, checked.value, assignments, signal,
        step => isBoundExecutableToolStep(step.toolId, registry, bindings.value, grantedTools) && permittedNow(step.toolId));
    },
    resume: (runId: AgentRunId, signal: AbortSignal) => coordinator.resume(runId, signal)
  };
}
