import {
  AgentCheckpointService, type AgentCheckpoint, type JsonValue
} from "./agentCheckpoints";
import type { ValidatedPlan } from "./agentPlanner";
import { err, ok, type Result } from "./result";

interface StepIdentity { id: string; toolId: string }
interface ActiveStep extends StepIdentity { index: number }
interface PlanRunState {
  kind: "nexus.plan-run.v1";
  steps: StepIdentity[];
  nextStep: number;
  active: ActiveStep | null;
  childRuns?: { index: number; runId: string }[];
}

function boundedIdentity(value: unknown, regex: RegExp): value is string {
  return typeof value === "string" && regex.test(value);
}

/**
 * Checkpoints contain only plan step identities and execution progress, never
 * the goal, tool inputs, tool results or secrets. The checkpoint is an
 * inspection/reconciliation record, NOT an automatic replay instruction.
 */
export class PlanRunCheckpointService {
  constructor(
    private readonly checkpoints: AgentCheckpointService,
    private readonly host: { agentId: string; threadId: string; now(): number; runIdPrefix?: string }
  ) {}

  async begin(runId: string, plan: ValidatedPlan): Promise<Result<PlanRunCheckpointSession>> {
    try {
      // Desktop parent coordinations and nested resumable agents can be given
      // the same external run ID by a host factory. Namespace the persisted
      // parent checkpoint to prevent identity collisions in shared SQLite.
      const storageRunId = (this.host.runIdPrefix ?? "") + runId;
      if (!boundedIdentity(runId, /^[A-Za-z0-9_-]{1,120}$/) ||
          !boundedIdentity(storageRunId, /^[A-Za-z0-9_-]{1,120}$/) ||
          (typeof this.host.threadId !== "string" || !this.host.threadId.trim() ||
            this.host.threadId.length > 160 || /[\u0000-\u001f\u007f]/.test(this.host.threadId)) ||
          !boundedIdentity(this.host.agentId, /^[A-Za-z0-9._-]{1,120}$/) ||
          !plan || typeof plan.goal !== "string" || !plan.goal.trim() ||
          !Array.isArray(plan.steps) || plan.steps.length < 1 || plan.steps.length > 12) {
        return err("validation", "Plan checkpoint identity or step budget is invalid.");
      }
      const ids = new Set<string>();
      const steps: StepIdentity[] = [];
      for (const step of plan.steps) {
        if (!step || !boundedIdentity(step.id, /^[A-Za-z0-9_-]{1,64}$/) ||
            ids.has(step.id) ||
            !boundedIdentity(step.toolId, /^[A-Za-z0-9._-]{1,120}$/)) {
          return err("validation", "Plan checkpoint step identities are invalid.");
        }
        ids.add(step.id);
        steps.push({ id: step.id, toolId: step.toolId });
      }
      const state: PlanRunState = {
        kind: "nexus.plan-run.v1", steps, nextStep: 0, active: null
      };
      const now = this.host.now();
      const checkpoint: AgentCheckpoint = {
        schemaVersion: 1, runId: storageRunId, agentId: this.host.agentId,
        threadId: this.host.threadId, sequence: 1, status: "running",
        state: state as unknown as JsonValue, createdAt: now, updatedAt: now
      };
      const persisted = await this.checkpoints.persist(checkpoint);
      if (!persisted.ok) return persisted;
      return ok(new PlanRunCheckpointSession(this.checkpoints, checkpoint, state, this.host.now));
    } catch {
      return err("storage_failed", "Could not safely create an agent plan checkpoint.");
    }
  }
}

/**
 * A single in-memory writer view of a durable run. Every transition uses the
 * same CAS repository as Desktop checkpoints. An interrupted in-flight step
 * remains visible as ambiguous; no method resumes or replays a dispatched tool.
 */
export class PlanRunCheckpointSession {
  constructor(
    private readonly checkpoints: AgentCheckpointService,
    private checkpoint: AgentCheckpoint,
    private state: PlanRunState,
    private readonly now: () => number
  ) {}

  private async commit(next: AgentCheckpoint, state: PlanRunState): Promise<Result<void>> {
    let persisted: Result<void>;
    try { persisted = await this.checkpoints.persist(next); }
    catch { return err("storage_failed", "Plan checkpoint update failed; inspect before retrying."); }
    if (!persisted.ok) return persisted;
    this.checkpoint = next;
    this.state = state;
    return ok(undefined);
  }

  private async transition(state: PlanRunState,
    status: "running" | "completed" | "failed" | "cancelled" = "running"): Promise<Result<void>> {
    // An approval checkpoint must not become runnable through a generic
    // step or failure transition: use the explicit approval continuation.
    if (this.checkpoint.status !== "running") {
      return err("validation", "Plan checkpoint is not in a runnable state.");
    }
    const next: AgentCheckpoint = {
      ...this.checkpoint, status, sequence: this.checkpoint.sequence + 1,
      state: state as unknown as JsonValue,
      updatedAt: Math.max(this.checkpoint.updatedAt, this.now())
    };
    return this.commit(next, state);
  }

  /** Wait at the delegation approval boundary, before dispatching a tool. */
  async waitForApproval(): Promise<Result<void>> {
    if (this.checkpoint.status !== "running" || this.state.active !== null) {
      return err("validation", "Cannot await approval after a tool was dispatched.");
    }
    const next: AgentCheckpoint = {
      ...this.checkpoint, sequence: this.checkpoint.sequence + 1,
      status: "waiting_for_approval",
      pendingApproval: { permission: "tool:execute", requestedAt: this.now() },
      updatedAt: Math.max(this.checkpoint.updatedAt, this.now())
    };
    return this.commit(next, this.state);
  }

  /** Host calls this only while processing an explicit approval continuation. */
  async resumeFromApproval(): Promise<Result<void>> {
    if (this.checkpoint.status !== "waiting_for_approval" ||
        this.checkpoint.pendingApproval?.permission !== "tool:execute" ||
        this.state.active !== null) {
      return err("validation", "No pending plan approval can be resumed.");
    }
    const next: AgentCheckpoint = {
      ...this.checkpoint, sequence: this.checkpoint.sequence + 1,
      status: "running",
      updatedAt: Math.max(this.checkpoint.updatedAt, this.now())
    };
    delete next.pendingApproval;
    return this.commit(next, this.state);
  }

  async beforeStep(index: number, id: string, toolId: string): Promise<Result<void>> {
    if (!Number.isSafeInteger(index) || index !== this.state.nextStep ||
        this.state.active !== null ||
        this.state.steps[index]?.id !== id || this.state.steps[index]?.toolId !== toolId) {
      return err("validation", "Plan dispatch does not match the next checkpointed step.");
    }
    return this.transition({
      ...this.state,
      active: { index, id, toolId }
    });
  }

  get storageRunId(): string { return this.checkpoint.runId; }

  /** Record the actual child ID before its checkpoint or any tool effect. */
  async bindChildRun(index: number, runId: string): Promise<Result<void>> {
    const previous = this.state.childRuns ?? [];
    if (!Number.isSafeInteger(index) || this.state.active?.index !== index ||
        index !== this.state.nextStep ||
        !boundedIdentity(runId, /^[A-Za-z0-9_-]{1,120}$/) ||
        runId === this.checkpoint.runId ||
        previous.some(link => link.index === index || link.runId === runId)) {
      return err("validation", "Delegated run identity does not match the active plan step.");
    }
    return this.transition({
      ...this.state,
      childRuns: [...previous, { index, runId }]
    });
  }

  async afterStep(index: number): Promise<Result<void>> {
    if (this.state.active?.index !== index ||
        index !== this.state.nextStep) {
      return err("validation", "Step completion has no matching dispatched checkpoint.");
    }
    return this.transition({
      ...this.state,
      active: null,
      nextStep: index + 1
    });
  }

  async complete(): Promise<Result<void>> {
    if (this.state.active || this.state.nextStep !== this.state.steps.length) {
      return err("validation", "Cannot complete a plan with unfinished or uncertain steps.");
    }
    return this.transition(this.state, "completed");
  }

  /** Preserves active-step uncertainty if a dispatched tool failed or was cancelled. */
  async interrupt(status: "failed" | "cancelled"): Promise<Result<void>> {
    if (this.checkpoint.status === "waiting_for_approval") {
      const next: AgentCheckpoint = {
        ...this.checkpoint, sequence: this.checkpoint.sequence + 1, status,
        updatedAt: Math.max(this.checkpoint.updatedAt, this.now())
      };
      delete next.pendingApproval;
      return this.commit(next, this.state);
    }
    return this.transition(this.state, status);
  }
}
