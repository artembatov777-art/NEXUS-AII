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
  mayExecute?: (step: AgentPlanStep) => boolean;
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
  // A run ID represents one execution attempt for the lifetime of this
  // coordinator. Evicting completed IDs would permit duplicate side effects.
  private readonly admitted = new Set<AgentRunId>();
  private readonly active = new Set<AgentRunId>();

  constructor(
    private readonly executor: AgentTaskExecutor,
    private readonly policy: CoordinatorPolicy,
    private readonly traces: TraceSink,
    private readonly clock: { now(): number },
    private readonly maxAgents = 4,
    private readonly maxLifetimeRuns = 4_096
  ) {}

  private stepPermitted(step: AgentPlanStep, mayExecute?: (step: AgentPlanStep) => boolean): boolean {
    if (!mayExecute) return true;
    try { return mayExecute(step) === true; }
    catch { return false; }
  }

  async *run(runId: AgentRunId, plan: AgentPlan, assignments: Record<string, AgentId>, signal: AbortSignal,
    mayExecute?: (step: AgentPlanStep) => boolean): AsyncIterable<CoordinationEvent> {
    if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(runId)) {
      yield { type: "failed", runId, detail: "Coordination run ID must be a valid, bounded identifier." };
      return;
    }
    if (!Number.isSafeInteger(this.maxLifetimeRuns) || this.maxLifetimeRuns < 1 ||
        this.admitted.has(runId) || this.admitted.size >= this.maxLifetimeRuns) {
      yield { type: "failed", runId, detail: "Coordination run ID was already used or the lifetime run budget is exhausted." };
      return;
    }
    const invalid = validateCoordinationInput(plan, assignments, this.maxAgents);
    if (invalid) { yield { type: "failed", runId, detail: invalid }; return; }
    // Detach the complete plan at the trust boundary. A shallow copy leaves nested
    // step.input objects mutable while a run is paused for owner approval.
    const serializedPlan = serializedJson(plan);
    if (serializedPlan === null) {
      yield { type: "failed", runId, detail: "Coordination plan is not serializable." };
      return;
    }
    const safePlan = JSON.parse(serializedPlan) as AgentPlan;
    const safeAssignments = Object.fromEntries(Object.entries(assignments)) as Record<string, AgentId>;
    const outputs = new Map<string, unknown>();
    // Claim the ID synchronously before yielding or awaiting anything, so
    // simultaneous callers cannot delegate the same plan concurrently.
    this.admitted.add(runId);
    this.active.add(runId);
    try {
      yield { type: "started", runId };
      await this.trace(runId, "started");
      yield* this.executeFrom(runId, safePlan, safeAssignments, 0, outputs, signal, mayExecute);
    } finally {
      this.active.delete(runId);
    }
  }

  /** Continues from the first unexecuted step after the host has granted the requested permission. */
  async *resume(runId: AgentRunId, signal: AbortSignal): AsyncIterable<CoordinationEvent> {
    if (this.active.has(runId)) {
      yield { type: "failed", runId, detail: "A coordination with this run ID is already active." };
      return;
    }
    const pending = this.pending.get(runId);
    if (!pending) { yield { type: "failed", runId, detail: "No pending coordination is available to resume." }; return; }
    // Resume claims the still-reserved run ID. An unrelated run() cannot
    // start under this ID even during the await inside executeFrom.
    this.pending.delete(runId);
    this.active.add(runId);
    try {
      if (signal.aborted) {
        await this.trace(runId, "cancelled");
        yield { type: "failed", runId, detail: "Coordination was cancelled." };
        return;
      }
      yield* this.executeFrom(runId, pending.plan, pending.assignments, pending.nextIndex, pending.outputs, signal, pending.mayExecute);
    } finally {
      this.active.delete(runId);
    }
  }

  private async *executeFrom(
    runId: AgentRunId,
    plan: AgentPlan,
    assignments: Record<string, AgentId>,
    start: number,
    outputs: Map<string, unknown>,
    signal: AbortSignal,
    mayExecute?: (step: AgentPlanStep) => boolean
  ): AsyncIterable<CoordinationEvent> {
    for (let index = start; index < plan.steps.length; index++) {
      const step: AgentPlanStep = plan.steps[index];
      const agentId = assignments[step.id];
      if (signal.aborted) {
        await this.trace(runId, "cancelled", { step: index + 1 });
        yield { type: "failed", runId, detail: "Coordination cancelled." };
        return;
      }
      // A host allowlist can change after a plan was created or while approval
      // is pending. Check immediately before every delegation, on both run
      // and resume. Missing, throwing, or revoked host grants fail closed.
      if (!this.stepPermitted(step, mayExecute)) {
        await this.trace(runId, "failed", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1,
          detail: "Planned tool is no longer permitted or registered." };
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
        this.pending.set(runId, { plan, assignments, nextIndex: index, outputs, mayExecute });
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
      // Authorization is asynchronous and may be followed by a checkpoint
      // write while yielding agent_started. Re-evaluate the live permission
      // immediately before the side-effect boundary, not only at step entry.
      if (!this.stepPermitted(step, mayExecute)) {
        await this.trace(runId, "failed", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1,
          detail: "Planned tool is no longer permitted or registered." };
        return;
      }
      yield { type: "agent_started", runId, agentId, step: index + 1 };
      await this.trace(runId, "progress", { step: index + 1 });
      if (signal.aborted || !this.stepPermitted(step, mayExecute)) {
        await this.trace(runId, signal.aborted ? "cancelled" : "failed", { step: index + 1 });
        yield { type: "failed", runId, agentId, step: index + 1,
          detail: signal.aborted ? "Coordination cancelled." : "Planned tool is no longer permitted or registered." };
        return;
      }
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
          ? `File: ${typeof outputRecord.path === "string" ? outputRecord.path : "workspace file"}\n\n${outputRecord.content}`
          : (JSON.stringify(bounded.value) ?? String(bounded.value));
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
