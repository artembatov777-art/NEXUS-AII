import { AgentCheckpointService, type AgentCheckpoint, type JsonValue } from "./agentCheckpoints";
import type { AgentClock, AgentId, AgentIdFactory, AgentPermission, AgentPermissionService, AgentRunId } from "./agents";
import { err, ok, type Result } from "./result";

export interface ResumableAgentContext {
  readonly runId: AgentRunId;
  readonly step: number;
  readonly signal: AbortSignal;
}
export interface ResumableAgentStepResult {
  state: JsonValue;
  done: boolean;
  progress?: string;
  output?: string;
}
export interface ResumableAgentDefinition<Input = unknown> {
  id: AgentId;
  version: string;
  name: string;
  requiredPermissions: AgentPermission[];
  maxSteps: number;
  timeoutMs: number;
  createState(input: Input): JsonValue;
  step(state: JsonValue, context: ResumableAgentContext): Promise<ResumableAgentStepResult>;
}
export type ResumableAgentEvent =
  | { type: "started"; runId: AgentRunId; agentId: AgentId }
  | { type: "progress"; runId: AgentRunId; step: number; maxSteps: number; label: string }
  | { type: "output"; runId: AgentRunId; content: string }
  | { type: "waiting_for_approval"; runId: AgentRunId; permission: AgentPermission }
  | { type: "completed"; runId: AgentRunId; steps: number }
  | { type: "failed"; runId: AgentRunId; message: string };

interface StoredAgentState { payload: JsonValue; permissionIndex: number; agentVersion: string; steps: number; }
const isStoredAgentState = (value: JsonValue): value is StoredAgentState =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  "payload" in value && "permissionIndex" in value &&
  Number.isInteger(value.permissionIndex) && Number(value.permissionIndex) >= 0 && typeof value.agentVersion === "string" && Number.isInteger(value.steps) && Number(value.steps) >= 0;
const packState = (payload: JsonValue, permissionIndex: number, agentVersion: string, steps = 0): JsonValue =>
  ({ payload, permissionIndex, agentVersion, steps } as JsonValue);

/** Serializable step execution. Each successful step is persisted before its events are emitted. */
export class ResumableAgentRuntime {
  private readonly definitions = new Map<AgentId, ResumableAgentDefinition<unknown>>();
  constructor(
    private readonly checkpoints: AgentCheckpointService,
    private readonly permissions: AgentPermissionService,
    private readonly ids: AgentIdFactory,
    private readonly clock: AgentClock
  ) {}

  register<Input>(definition: ResumableAgentDefinition<Input>): Result<void> {
    if (!definition.id.trim() || !definition.version.trim() || !definition.name.trim()) return err("validation", "Agent id, version, and name are required.");
    if (this.definitions.has(definition.id)) return err("validation", "Agent is already registered.");
    if (!Number.isInteger(definition.maxSteps) || definition.maxSteps < 1 || definition.maxSteps > 100) return err("validation", "maxSteps must be from 1 to 100.");
    if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 1_000 || definition.timeoutMs > 600_000) return err("validation", "timeoutMs must be from 1,000 to 600,000.");
    this.definitions.set(definition.id, definition as ResumableAgentDefinition<unknown>);
    return ok(undefined);
  }

  async *start<Input>(agentId: AgentId, input: Input, threadId: string, signal?: AbortSignal): AsyncIterable<ResumableAgentEvent> {
    const runId = this.ids.runId();
    const agent = this.definitions.get(agentId) as ResumableAgentDefinition<Input> | undefined;
    if (!agent || !threadId.trim()) { yield { type: "failed", runId, message: "Registered agent and thread id are required." }; return; }
    if (signal?.aborted) { yield { type: "failed", runId, message: "Agent run was cancelled before it started." }; return; }
    let payload: JsonValue;
    try { payload = agent.createState(input); }
    catch { yield { type: "failed", runId, message: "Agent could not create its initial state." }; return; }

    const now = this.clock.now();
    const initial: AgentCheckpoint = { schemaVersion: 1, runId, agentId, threadId, sequence: 1,
      status: "running", state: packState(payload, 0, agent.version), createdAt: now, updatedAt: now };
    const auth = await this.authorizeRemaining(agent, 0);
    if (auth.kind === "denied") {
      const saved = await this.checkpoints.persist({ ...initial, status: "failed" });
      yield { type: "failed", runId, message: saved.ok ? "Required permission was denied." : saved.error.message }; return;
    }
    if (auth.kind === "approval") {
      const waiting: AgentCheckpoint = { ...initial, status: "waiting_for_approval",
        pendingApproval: { permission: auth.permission, requestedAt: this.clock.now() },
        state: packState(payload, auth.nextIndex, agent.version) };
      const saved = await this.checkpoints.persist(waiting);
      if (!saved.ok) { yield { type: "failed", runId, message: saved.error.message }; return; }
      yield { type: "waiting_for_approval", runId, permission: auth.permission }; return;
    }
    const ready = { ...initial, state: packState(payload, auth.nextIndex, agent.version) };
    const saved = await this.checkpoints.persist(ready);
    if (!saved.ok) { yield { type: "failed", runId, message: saved.error.message }; return; }
    yield* this.execute(agent, ready, payload, auth.nextIndex, 0, signal);
  }

  async *resume(runId: AgentRunId, approvedPermission: AgentPermission, signal?: AbortSignal): AsyncIterable<ResumableAgentEvent> {
    const loaded = await this.checkpoints.get(runId);
    if (!loaded.ok || !loaded.value) { yield { type: "failed", runId, message: loaded.ok ? "Checkpoint was not found." : loaded.error.message }; return; }
    const cp = loaded.value;
    const agent = this.definitions.get(cp.agentId as AgentId);
    if (!agent || cp.status !== "waiting_for_approval" || cp.pendingApproval?.permission !== approvedPermission || !isStoredAgentState(cp.state) || cp.state.agentVersion !== agent.version) {
      yield { type: "failed", runId, message: "Checkpoint is not awaiting this approval, or its agent is unavailable." }; return;
    }
    if (signal?.aborted) { yield { type: "failed", runId, message: "Agent run was cancelled." }; return; }
    const payload = cp.state.payload;
    const nextIndex = cp.state.permissionIndex + 1;
    const resumed: AgentCheckpoint = { ...cp, sequence: cp.sequence + 1, status: "running",
      state: packState(payload, nextIndex, agent.version, cp.state.steps), updatedAt: this.clock.now() };
    delete resumed.pendingApproval;
    const saved = await this.checkpoints.persist(resumed);
    if (!saved.ok) { yield { type: "failed", runId, message: saved.error.message }; return; }

    const auth = await this.authorizeRemaining(agent, nextIndex);
    if (auth.kind === "denied") { yield* this.finishFailure(resumed, runId, "A required permission was denied."); return; }
    if (auth.kind === "approval") {
      const waiting: AgentCheckpoint = { ...resumed, sequence: resumed.sequence + 1, status: "waiting_for_approval",
        state: packState(payload, auth.nextIndex, agent.version), pendingApproval: { permission: auth.permission, requestedAt: this.clock.now() },
        updatedAt: this.clock.now() };
      const result = await this.checkpoints.persist(waiting);
      if (!result.ok) { yield { type: "failed", runId, message: result.error.message }; return; }
      yield { type: "waiting_for_approval", runId, permission: auth.permission }; return;
    }
    let ready = resumed;
    if (auth.nextIndex !== nextIndex) {
      ready = { ...resumed, sequence: resumed.sequence + 1, state: packState(payload, auth.nextIndex, agent.version), updatedAt: this.clock.now() };
      const result = await this.checkpoints.persist(ready);
      if (!result.ok) { yield { type: "failed", runId, message: result.error.message }; return; }
    }
    yield* this.execute(agent, ready, payload, auth.nextIndex, cp.state.steps, signal);
  }

  /** Claims an interrupted running checkpoint with CAS, then continues from its saved state. */
  async *continue(runId: AgentRunId, signal?: AbortSignal): AsyncIterable<ResumableAgentEvent> {
    const loaded = await this.checkpoints.get(runId);
    if (!loaded.ok || !loaded.value) {
      yield { type: "failed", runId, message: loaded.ok ? "Checkpoint was not found." : loaded.error.message };
      return;
    }
    const cp = loaded.value;
    const agent = this.definitions.get(cp.agentId as AgentId);
    if (!agent || cp.status !== "running" || !isStoredAgentState(cp.state) || cp.state.agentVersion !== agent.version) {
      yield { type: "failed", runId, message: "Only a running checkpoint with a registered agent can be continued." };
      return;
    }
    if (signal?.aborted) { yield { type: "failed", runId, message: "Agent run was cancelled." }; return; }
    const claimed: AgentCheckpoint = { ...cp, sequence: cp.sequence + 1, updatedAt: this.clock.now() };
    const saved = await this.checkpoints.persist(claimed);
    if (!saved.ok) {
      yield { type: "failed", runId, message: "Checkpoint could not be claimed; another worker may already be continuing it." };
      return;
    }
    yield* this.execute(agent, claimed, cp.state.payload, cp.state.permissionIndex, cp.state.steps, signal);
  }

  private async authorizeRemaining(agent: ResumableAgentDefinition<unknown>, startIndex: number):
    Promise<{ kind: "allowed"; nextIndex: number } | { kind: "approval"; permission: AgentPermission; nextIndex: number } | { kind: "denied" }> {
    for (let index = startIndex; index < agent.requiredPermissions.length; index += 1) {
      let decision: "allow" | "deny" | "ask_user";
      try { decision = await this.permissions.authorize({ agentId: agent.id, permission: agent.requiredPermissions[index],
        reason: `Agent "${agent.name}" requires ${agent.requiredPermissions[index]}.` }); }
      catch { return { kind: "denied" }; }
      if (decision === "deny") return { kind: "denied" };
      if (decision === "ask_user") return { kind: "approval", permission: agent.requiredPermissions[index], nextIndex: index };
    }
    return { kind: "allowed", nextIndex: agent.requiredPermissions.length };
  }

  private async *execute(agent: ResumableAgentDefinition<unknown>, checkpoint: AgentCheckpoint,
    initialState: JsonValue, permissionIndex: number, completedSteps: number, externalSignal?: AbortSignal): AsyncIterable<ResumableAgentEvent> {
    const runId = checkpoint.runId as AgentRunId;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    let state = initialState;
    let sequence = checkpoint.sequence;
    let steps = completedSteps;
    let timedOut = false;
    const remainingTimeout = Math.max(0, agent.timeoutMs - (this.clock.now() - checkpoint.createdAt));
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, remainingTimeout);
    yield { type: "started", runId, agentId: agent.id };
    try {
      while (steps < agent.maxSteps) {
        if (controller.signal.aborted) throw new Error(timedOut ? "Agent timed out." : "Agent was cancelled.");
        const abort = new Promise<never>((_, reject) => controller.signal.addEventListener("abort",
          () => reject(new Error(timedOut ? "Agent timed out." : "Agent was cancelled.")), { once: true }));
        const result = await Promise.race([agent.step(state, { runId, step: steps + 1, signal: controller.signal }), abort]);
        if (result.output !== undefined && result.output.length > 20_000) throw new Error("Agent output exceeded the 20,000 character limit.");
        if (result.progress !== undefined && (!result.progress.trim() || result.progress.length > 200)) throw new Error("Progress labels must contain 1 to 200 characters.");
        state = result.state;
        steps += 1;
        const next: AgentCheckpoint = { ...checkpoint, sequence: sequence + 1, status: result.done ? "completed" : "running",
          state: packState(state, permissionIndex, agent.version, steps), updatedAt: this.clock.now() };
        delete next.pendingApproval;
        const persisted = await this.checkpoints.persist(next);
        if (!persisted.ok) throw new Error(persisted.error.message);
        sequence += 1;
        checkpoint = next;
        if (result.progress) yield { type: "progress", runId, step: steps, maxSteps: agent.maxSteps, label: result.progress };
        if (result.output) yield { type: "output", runId, content: result.output };
        if (result.done) { yield { type: "completed", runId, steps }; return; }
      }
      const failed: AgentCheckpoint = { ...checkpoint, sequence: sequence + 1, status: "failed", updatedAt: this.clock.now() };
      const persisted = await this.checkpoints.persist(failed);
      yield { type: "failed", runId, message: persisted.ok ? "Agent step budget exhausted." : persisted.error.message };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unexpected agent error.";
      const latest = await this.checkpoints.get(runId);
      if (latest.ok && latest.value && !["completed", "failed", "cancelled"].includes(latest.value.status)) {
        await this.checkpoints.persist({ ...latest.value, sequence: latest.value.sequence + 1,
          status: controller.signal.aborted && !timedOut ? "cancelled" : "failed",
          updatedAt: this.clock.now() });
      }
      yield { type: "failed", runId, message };
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    }
  }

  private async *finishFailure(checkpoint: AgentCheckpoint, runId: string, message: string): AsyncIterable<ResumableAgentEvent> {
    const saved = await this.checkpoints.persist({ ...checkpoint, sequence: checkpoint.sequence + 1,
      status: "failed", updatedAt: this.clock.now() });
    yield { type: "failed", runId, message: saved.ok ? message : saved.error.message };
  }
}
