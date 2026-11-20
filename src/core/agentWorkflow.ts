import type { AgentId, AgentRunId } from './agents';
import type { AgentPlanner, ValidatedPlan } from './agentPlanner';
import { captureExecutableToolRegistrations, isBoundExecutableToolStep, isExecutableToolStep, validateExecutablePlan } from './agentExecutionPolicy';
import type { MultiAgentCoordinator, CoordinationEvent } from './multiAgentCoordinator';
import type { ToolRegistry } from './toolRegistry';
import { err, type Result } from './result';
import { PlanRunCheckpointService, type PlanRunCheckpointSession } from './planRunCheckpoints';

/** Host-neutral workflow; the host supplies the checkpointed coordinator and tool registry. */
export function createAgentWorkflow(planner: AgentPlanner, registry: ToolRegistry, coordinator: MultiAgentCoordinator,
  agentId: AgentId, allowedToolIds?: readonly string[], checkpoints?: PlanRunCheckpointService) {
  const grantedTools = allowedToolIds ? [...allowedToolIds] : undefined;
  const allowed = grantedTools ? new Set(grantedTools) : null;
  // The original owner list may narrow during approval. Never widen the
  // admission-time snapshot, but honor live revocations on each delegation.
  const permittedNow = (toolId: string) =>
    isExecutableToolStep(toolId, registry, grantedTools) &&
    isExecutableToolStep(toolId, registry, allowedToolIds);
  // Only a live owner-approved workflow may continue an approval pause.
  // On process restart, checkpoints remain inspectable but the in-memory
  // execution authority is gone: never reconstruct or replay a tool from it.
  const pending = new Map<AgentRunId, {
    checkpoint: PlanRunCheckpointSession; plan: ValidatedPlan
  }>();

  const track = async function* (
    runId: AgentRunId, events: AsyncIterable<CoordinationEvent>,
    record: { checkpoint: PlanRunCheckpointSession; plan: ValidatedPlan }
  ): AsyncIterable<CoordinationEvent> {
    const storageError = (detail: string): CoordinationEvent => ({
      type: "failed", runId, detail
    });
    try {
      for await (const event of events) {
        if (event.type === "agent_started") {
          const index = (event.step ?? 0) - 1;
          const step = record.plan.steps[index];
          const stored = step && await record.checkpoint.beforeStep(index, step.id, step.toolId);
          if (!stored || !stored.ok) {
            pending.delete(runId);
            yield storageError("Could not persist tool dispatch; no uncheckpointed delegation is permitted.");
            return;
          }
        } else if (event.type === "agent_completed") {
          const index = (event.step ?? 0) - 1;
          const stored = await record.checkpoint.afterStep(index);
          if (!stored.ok) {
            pending.delete(runId);
            yield storageError("Tool may have executed, but its completion checkpoint is unavailable. Inspect the tool audit before retrying.");
            return;
          }
        } else if (event.type === "waiting_for_approval") {
          const stored = await record.checkpoint.waitForApproval();
          if (!stored.ok) {
            pending.delete(runId);
            yield storageError("Could not checkpoint the approval pause; owner continuation is blocked.");
            return;
          }
          yield event;
          return;
        } else if (event.type === "failed") {
          const stored = await record.checkpoint.interrupt("failed");
          pending.delete(runId);
          if (!stored.ok) {
            yield storageError("Agent failed and its checkpoint could not be confirmed. Inspect audit before retrying.");
            return;
          }
          yield event;
          return;
        } else if (event.type === "completed") {
          const stored = await record.checkpoint.complete();
          pending.delete(runId);
          if (!stored.ok) {
            yield storageError("All delegated tools returned, but the final checkpoint is unconfirmed.");
            return;
          }
          yield event;
          return;
        }
        yield event;
      }
      pending.delete(runId);
      const stored = await record.checkpoint.interrupt("failed");
      yield storageError(stored.ok
        ? "Agent coordinator ended without a terminal event."
        : "Agent coordinator ended and its checkpoint could not be verified.");
    } catch {
      pending.delete(runId);
      await record.checkpoint.interrupt("failed").catch(() => {});
      yield storageError("Agent coordination failed unexpectedly. Inspect checkpoint and audit.");
    }
  };

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
      const coordinated = coordinator.run(runId, checked.value, assignments, signal,
        step => isBoundExecutableToolStep(step.toolId, registry, bindings.value, grantedTools) && permittedNow(step.toolId));
      if (!checkpoints) {
        yield* coordinated;
        return;
      }
      const begun = await checkpoints.begin(runId, checked.value);
      if (!begun.ok) {
        yield { type: "failed", runId, detail: "Could not claim agent plan checkpoint; no tool was delegated." };
        return;
      }
      const record = { checkpoint: begun.value, plan: checked.value };
      pending.set(runId, record);
      yield* track(runId, coordinated, record);
    },
    resume: async function* (runId: AgentRunId, signal: AbortSignal): AsyncIterable<CoordinationEvent> {
      if (!checkpoints) {
        yield* coordinator.resume(runId, signal);
        return;
      }
      const record = pending.get(runId);
      if (!record) {
        yield { type: "failed", runId, detail: "No live approved workflow can resume this checkpoint. Inspect before starting a new run." };
        return;
      }
      if (signal.aborted) {
        pending.delete(runId);
        await record.checkpoint.interrupt("cancelled");
        yield { type: "failed", runId, detail: "Agent continuation was cancelled." };
        return;
      }
      const resumed = await record.checkpoint.resumeFromApproval();
      if (!resumed.ok) {
        pending.delete(runId);
        yield { type: "failed", runId, detail: "Could not revalidate approval checkpoint. No tool was delegated." };
        return;
      }
      yield* track(runId, coordinator.resume(runId, signal), record);
    }
  };
}
