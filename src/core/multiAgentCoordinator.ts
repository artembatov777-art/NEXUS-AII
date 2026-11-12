import type { Result } from "./result";
import type { AgentId, AgentRunId } from "./agents";
import type { AgentPlan, AgentPlanStep } from "./agentPlanner";
import type { TraceSink } from "./observability";

export interface AgentTaskExecutor {
  execute(agentId: AgentId, input: unknown, signal: AbortSignal): Promise<Result<unknown>>;
}
export interface CoordinatorPolicy {
  authorize(agentId: AgentId, reason: string): Promise<"allow" | "deny" | "ask_user">;
}
export type CoordinationEvent = {
  type: "started" | "agent_started" | "agent_completed" | "waiting_for_approval" | "completed" | "failed";
  runId: AgentRunId;
  agentId?: AgentId;
  step?: number;
  detail?: string;
};
interface PendingCoordination {
  plan: AgentPlan;
  assignments: Record<string, AgentId>;
  nextIndex: number;
  outputs: Map<string, unknown>;
}

const MAX_PLAN_BYTES = 64_000;
const MAX_DELEGATED_OUTPUT_BYTES = 64_000;

function serializedJson(value: unknown): string | null {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded : null;
  } catch {
    return null;
  }
}

/** Detach untrusted executor output from mutable objects and enforce a strict JSON boundary. */
function boundedJsonOutput(value: unknown): { ok: true; value: unknown } | { ok: false } {
  const encoded = serializedJson(value);
  if (encoded === null || new TextEncoder().encode(encoded).byteLength > MAX_DELEGATED_OUTPUT_BYTES) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(encoded) as unknown };
  } catch {
    return { ok: false };
  }
}

function validateCoordinationInput(plan: AgentPlan, assignments: Record<string, AgentId>, maxAgents: number): string | undefined {
  if (!plan || typeof plan.goal !== "string" || !plan.goal.trim() || plan.goal.length > 2_000 ||
      !Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > maxAgents) {
    return "Coordination plan is empty or exceeds the agent budget.";
  }
  const serialized = serializedJson(plan);
  if (serialized === null) return "Coordination plan is not serializable.";
  if (new TextEncoder().encode(serialized).byteLength > MAX_PLAN_BYTES) return "Coordination plan exceeds the 64 KB limit.";
  const known = new Set<string>();
  for (const step of plan.steps) {
    if (!step || typeof step.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(step.id) || known.has(step.id)) {
      return "Coordination step IDs must be unique and valid.";
    }
    if (typeof step.toolId !== "string" || !step.toolId.trim() || step.toolId.length > 160 ||
        typeof step.purpose !== "string" || !step.purpose.trim() || step.purpose.length > 500 ||
        !Array.isArray(step.dependsOn) || step.dependsOn.length > maxAgents) {
      return "Coordination step metadata is invalid.";
    }
    if (step.dependsOn.some(dep => typeof dep !== "string" || dep === step.id || !known.has(dep)) ||
        new Set(step.dependsOn).size !== step.dependsOn.length) {
      return "Dependencies must reference unique, previously declared steps.";
    }
    known.add(step.id);
  }
  const assignmentKeys = Object.keys(assignments ?? {});
  if (assignmentKeys.length !== known.size || assignmentKeys.some(id => !known.has(id))) {
    return "Every plan step must have exactly one agent assignment.";
  }
  if (Object.values(assignments).some(id => typeof id !== "string" || !id.trim() || id.length > 128)) {
    return "Agent assignments contain an invalid agent ID.";
  }
  return undefined;
}

export class MultiAgentCoordinator {
  private readonly pending = new Map<AgentRunId, PendingCoordination>();

  constructor(
    private readonly executor: AgentTaskExecutor,
    private readonly policy: CoordinatorPolicy,
    private readonly traces: TraceSink,
    private readonly clock: { now(): number },
    private readonly maxAgents = 4
  ) {}

  async *run(runId: AgentRunId, plan: AgentPlan, assignments: Record<string, AgentId>, signal: AbortSignal): AsyncIterable<CoordinationEvent> {
    if (this.pending.has(runId)) {
      yield { type: "failed", runId, detail: "A coordination with this run ID is already waiting for approval." };
      return;
    }
    const invalid = validateCoordinationInput(plan, assignments, this.maxAgents);
    if (invalid) { yield { type: "failed", runId, detail: invalid }; return; }
    const safePlan: AgentPlan = {
      goal: plan.goal,
      steps: plan.steps.map(step => ({ ...step, dependsOn: [...step.dependsOn] }))
    };
    const safeAssignments = { ...assignments };
    const outputs = new Map<string, unknown>();
    yield { type: "started", runId };
    await this.trace(runId, "started");
    yield* this.executeFrom(runId, safePlan, safeAssignments, 0, outputs, signal);
  }

  /** Continues from the first unexecuted step after the host has granted the requested permission. */
  async *resume(runId: AgentRunId, signal: AbortSignal): AsyncIterable<CoordinationEvent> {
    const pending = this.pending.get(runId);
    if (!pending) { yield { type: "failed", runId, detail: "No pending coordination is available to resume." }; return; }
    this.pending.delete(runId);
    if (signal.aborted) {
      await this.trace(runId, "cancelled");
      yield { type: "failed", runId, detail: "Coordination was cancelled." };
      return;
    }
    yield* this.executeFrom(runId, pending.plan, pending.assignments, pending.nextIndex, pending.outputs, signal);
  }

  private async *executeFrom(
    runId: AgentRunId,
    plan: AgentPlan,
    assignments: Record<string, AgentId>,
    start: number,
    outputs: Map<string, unknown>,
    signal: AbortSignal
  ): AsyncIterable<CoordinationEvent> {
    for (let index = start; index < plan.steps.length; index++) {
      const step: AgentPlanStep = plan.steps[index];
      const agentId = assignments[step.id];
      if (signal.aborted) {
        await this.trace(runId, "cancelled", { step: index + 1 });
        yield { type: "failed", runId, detail: "Coordination cancelled." };
        return;
      }
      if (!agentId) {
        await this.trace(runId, "failed", { step: index + 1 });
        yield { type: "failed", runId, detail: `No agent assigned to step ${step.id}.` };
        return;
      }
      if (step.dependsOn.some(dep => !outputs.has(dep))) {
        await this.trace(runId, "failed", { step: index + 1 });
        yield { type: "failed", runId, detail: "A dependency has no completed result." };
        return;
      }
      let decision: "allow" | "deny" | "ask_user";
      try {
        decision = await this.policy.authorize(agentId, `Execute delegated plan step: ${step.purpose}`);
      } catch {
        decision = "deny";
      }
      if (signal.aborted) {
        await this.trace(runId, "cancelled", { step: index + 1 });
        yield { type: "failed", runId, detail: "Coordination cancelled." };
        return;
      }
      if (decision === "ask_user") {
        this.pending.set(runId, { plan, assignments, nextIndex: index, outputs });
        await this.trace(runId, "waiting_for_approval", { step: index + 1 });
        yield { type: "waiting_for_approval", runId, agentId, step: index + 1,
          detail: "Explicit host approval is required before this agent starts." };
        return;
      }
      if (decision === "deny") {
        await this.trace(runId, "failed", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1, detail: "Agent delegation was denied." };
        return;
      }
      yield { type: "agent_started", runId, agentId, step: index + 1 };
      await this.trace(runId, "progress", { step: index + 1 });
      const input = {
        ...((step.input && typeof step.input === "object" && !Array.isArray(step.input))
          ? step.input as Record<string, unknown> : { value: step.input }),
        toolId: step.toolId,
        input: step.input,
        dependencyResults: Object.fromEntries(step.dependsOn.map(dep => [dep, outputs.get(dep)])),
        goal: plan.goal,
        purpose: step.purpose
      };
      let result: Result<unknown>;
      try {
        result = await this.executor.execute(agentId, input, signal);
      } catch {
        await this.trace(runId, signal.aborted ? "cancelled" : "failed", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1,
          detail: signal.aborted ? "Coordination cancelled." : "Delegated agent execution failed unexpectedly." };
        return;
      }
      if (signal.aborted) {
        await this.trace(runId, "cancelled", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1, detail: "Coordination cancelled." };
        return;
      }
      if (!result.ok) {
        await this.trace(runId, "failed", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1, detail: result.error.message.slice(0, 500) };
        return;
      }
      const bounded = boundedJsonOutput(result.value);
      if (!bounded.ok) {
        await this.trace(runId, "failed", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1,
          detail: "Delegated output is not valid JSON or exceeds the 64 KB limit." };
        return;
      }
      outputs.set(step.id, bounded.value);
      const outputRecord = bounded.value && typeof bounded.value === "object" && !Array.isArray(bounded.value)
        ? bounded.value as Record<string, unknown> : null;
      const renderedOutput = typeof bounded.value === "string" ? bounded.value
        : outputRecord && typeof outputRecord.content === "string"
          ? `File: ${typeof outputRecord.path === "string" ? outputRecord.path : "workspace file"}\\n\\n${outputRecord.content}`
          : JSON.stringify(bounded.value);
      const detail = renderedOutput.length > 10_000
        ? renderedOutput.slice(0, 10_000) + "\n[Output preview truncated at 10,000 characters.]"
        : renderedOutput;
      yield { type: "agent_completed", runId, agentId, step: index + 1, detail };
    }
    await this.trace(runId, "completed", { agents: plan.steps.length });
    yield { type: "completed", runId, detail: `Completed ${outputs.size} delegated steps.` };
  }

  private async trace(
    runId: AgentRunId,
    status: "started" | "progress" | "waiting_for_approval" | "completed" | "failed" | "cancelled",
    attributes?: Record<string, string | number | boolean>
  ): Promise<void> {
    await this.traces.append({
      traceId: `coord:${runId}`, runId, name: "multi_agent.coordination", status, timestamp: this.clock.now(),
      ...(status === "completed" || status === "failed" || status === "cancelled" ? { durationMs: 0 } : {}),
      attributes
    });
  }
}
