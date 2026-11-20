import { validateAgentCheckpoint, type AgentCheckpoint } from "../core/agentCheckpoints";
import { agentThreads } from "./agentThreads";
import { filterAgentEvents } from "./agentRunEventFilter";
import { agentRunTimeline } from "./agentRunTimeline";
import { agentRunEventPreview } from "./agentRunEventPreview";
import { summarizeRuns } from "./agentRunSummary";
import { validAgentRunIdentity } from "./agentRunIdentity";
/**
 * Owns the lifetime of foreground agent tasks independently of React panels.
 * UI subscribers may mount/unmount without cancelling the underlying task.
 */
export type ManagedRunStatus = "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled" | "interrupted";
export interface ManagedRun {
  id: string;
  conversationId: string;
  status: ManagedRunStatus;
  error?: string;
  runtimeRunId?: string;
  startedAt: number;
  finishedAt?: number;
}
export interface ManagedRunEvent {
  runId: string;
  conversationId: string;
  timestamp: number;
  kind: "progress" | "output" | "approval" | "error";
  message: string;
}
export type ManagedRunListener = (runs: readonly ManagedRun[]) => void;
export type ManagedRunEventListener = (event: ManagedRunEvent) => void;

export class AgentRunManager {
  private readonly runs = new Map<string, ManagedRun>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<ManagedRunListener>();
  private readonly eventListeners = new Set<ManagedRunEventListener>();
  private readonly activeByConversation = new Map<string, string>();
  private readonly events = new Map<string, ManagedRunEvent[]>();
  private readonly restoredRunSequences = new Map<string, number>();

  list(conversationId?: string): ManagedRun[] {
    return [...this.runs.values()]
      .filter(run => conversationId === undefined || run.conversationId === conversationId)
      .map(run => ({ ...run }));
  }

  /** Reconstruct display state from durable checkpoints; never resumes a task. */
  restoreCheckpoints(conversationId: string, checkpoints: readonly AgentCheckpoint[]): void {
    if (this.activeByConversation.has(conversationId)) return;
    const threads = Object.values(agentThreads(conversationId === "standalone" ? undefined : conversationId));
    let changed = false;
    // Multiple versions of a run may be returned by a repository or import.
    // Recover from the newest valid snapshot, never from whichever arrives first.
    const latest = new Map<string, AgentCheckpoint>();
    for (const checkpoint of checkpoints) {
      if (validateAgentCheckpoint(checkpoint) || !threads.includes(checkpoint.threadId) || !validAgentRunIdentity(checkpoint.runId, conversationId)) continue;
      const previous = latest.get(checkpoint.runId);
      if (!previous || checkpoint.sequence > previous.sequence || (checkpoint.sequence === previous.sequence && checkpoint.updatedAt > previous.updatedAt)) {
        latest.set(checkpoint.runId, checkpoint);
      }
    }
    // Index existing owners once: bulk recovery must not scan every run for
    // each restored checkpoint (quadratic time on large histories).
    const ownedRuntimeIds = new Set(
      [...this.runs.values()].map(run => run.runtimeRunId).filter((id): id is string => id !== undefined)
    );
    for (const checkpoint of latest.values()) {
      const status = checkpoint.status === "running" ? "interrupted" : checkpoint.status;
      const terminal = status === "completed" || status === "failed" || status === "cancelled";
      const previousSequence = this.restoredRunSequences.get(checkpoint.runId);
      if (previousSequence !== undefined) {
        if (checkpoint.sequence <= previousSequence) continue;
        const restored = this.runs.get(checkpoint.runId);
        if (restored && restored.conversationId === conversationId && restored.runtimeRunId === checkpoint.runId) {
          this.runs.set(checkpoint.runId, {
            ...restored, status, finishedAt: terminal ? checkpoint.updatedAt : undefined
          });
          this.restoredRunSequences.set(checkpoint.runId, checkpoint.sequence);
          changed = true;
        }
        continue;
      }
      if (ownedRuntimeIds.has(checkpoint.runId) || this.runs.has(checkpoint.runId)) continue;
      this.runs.set(checkpoint.runId, { id: checkpoint.runId, runtimeRunId: checkpoint.runId, conversationId, status, startedAt: checkpoint.createdAt, ...(terminal ? { finishedAt: checkpoint.updatedAt } : {}) });
      this.restoredRunSequences.set(checkpoint.runId, checkpoint.sequence);
      ownedRuntimeIds.add(checkpoint.runId);
      changed = true;
    }
    if (changed) {
      this.pruneFinished();
      this.publish();
    }
  }

  summary(conversationId?: string) {
    return summarizeRuns(this.list(), conversationId);
  }

  activeRun(conversationId: string): ManagedRun | null {
    const id = this.activeByConversation.get(conversationId);
    const run = id ? this.runs.get(id) : undefined;
    return run ? { ...run } : null;
  }

  linkRuntimeRun(managerId: string, runtimeRunId: string, allowApprovalHandoff = false): void {
    const run = this.runs.get(managerId);
    if (!run) throw new Error("Managed run was not found.");
    if (!validAgentRunIdentity(runtimeRunId, run.conversationId)) throw new Error("Invalid runtime run ID.");
    if (run.runtimeRunId === runtimeRunId) return; // Further events in the same run are idempotent.
    if (run.runtimeRunId) throw new Error("Managed run already references a different runtime run.");
    const existingOwners = this.list().filter(other => other.id !== managerId && other.runtimeRunId === runtimeRunId);
    if (existingOwners.length) {
      const sameConversation = existingOwners.every(owner => owner.conversationId === run.conversationId);
      if (!sameConversation) throw new Error("Runtime run is owned by another conversation.");
      // Resuming a previously approved checkpoint uses the same runtime ID in
      // a new manager task. It is the only permitted temporary dual ownership.
      const validHandoff = allowApprovalHandoff && run.status === "running" &&
        existingOwners.length === 1 && (existingOwners[0].status === "waiting_for_approval" || existingOwners[0].status === "interrupted");
      if (!validHandoff) throw new Error("Runtime run is already linked to another managed run.");
    }
    this.runs.set(managerId, { ...run, runtimeRunId });
    this.publish();
  }

  resolveWaiting(runtimeRunId: string, status: "completed" | "failed"): boolean {
    for (const [managerId, run] of this.runs) {
      if (run.runtimeRunId === runtimeRunId && run.status === "waiting_for_approval") {
        this.runs.set(managerId, { ...run, status, finishedAt: Date.now() });
        this.pruneFinished();
        this.publish();
        return true;
      }
    }
    return false;
  }

  history(runId: string): ManagedRunEvent[] {
    return (this.events.get(runId) ?? []).map(event => ({ ...event }));
  }

  eventsByKind(conversationId: string, kinds: readonly ManagedRunEvent["kind"][]): ManagedRunEvent[] {
    return filterAgentEvents(this.conversationTimeline(conversationId), conversationId, kinds);
  }

  conversationTimeline(conversationId: string): ManagedRunEvent[] {
    const events = this.list(conversationId).flatMap(run => this.history(run.id));
    return agentRunTimeline(events, conversationId);
  }

  eventPreview(runId: string, maxLength = 240): string[] {
    return this.history(runId).map(event => agentRunEventPreview(event.message, maxLength));
  }

  appendEvent(runId: string, kind: ManagedRunEvent["kind"], message: string): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Unknown run ID.");
    const events = this.events.get(runId) ?? [];
    const boundedMessage = message.length > 16_000 ? message.slice(0, 16_000) + "\n[Event output truncated]" : message;
    const event: ManagedRunEvent = { runId, conversationId: run.conversationId, timestamp: Date.now(), kind, message: boundedMessage };
    events.push(event);
    this.events.set(runId, events.slice(-200));
    for (const listener of [...this.eventListeners]) {
      try { listener({ ...event }); } catch { /* Observers never interrupt agent execution. */ }
    }
    // Run-state subscribers need no rerender for high-frequency progress messages.
    // Consumers of event history can request the latest bounded snapshot explicitly.
  }

  subscribeEvents(listener: ManagedRunEventListener): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  subscribe(listener: ManagedRunListener): () => void {
    this.listeners.add(listener);
    try { listener(this.list()); } catch { /* A broken UI observer must not break the running agent. */ }
    return () => { this.listeners.delete(listener); };
  }

  private pruneFinished(): void {
    const completed = [...this.runs.entries()].filter(([, run]) => run.status === "completed" || run.status === "failed" || run.status === "cancelled");
    const excess = completed.length - 250;
    if (excess <= 0) return;
    completed.sort((a, b) => (a[1].finishedAt ?? a[1].startedAt) - (b[1].finishedAt ?? b[1].startedAt));
    for (const [id] of completed.slice(0, excess)) {
      this.runs.delete(id);
      this.events.delete(id);
      this.restoredRunSequences.delete(id);
    }
  }

  private publish(): void {
    const snapshot = this.list();
    for (const listener of [...this.listeners]) {
      try { listener(snapshot); } catch { /* UI observers must be isolated from execution. */ }
    }
  }

  start(id: string, conversationId: string, task: (signal: AbortSignal) => Promise<void | "waiting_for_approval" | "failed">): Promise<void> {
    if (!validAgentRunIdentity(id, conversationId)) throw new Error("Invalid run or conversation ID.");
    if (this.runs.has(id)) throw new Error("A run with this ID already exists.");
    if (this.activeByConversation.has(conversationId)) throw new Error("Conversation already has an active run.");
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.activeByConversation.set(conversationId, id);
    this.runs.set(id, { id, conversationId, status: "running", startedAt: Date.now() });
    this.publish();
    return (async () => {
      try {
        const outcome = await task(controller.signal);
        this.runs.set(id, { ...this.runs.get(id)!, status: controller.signal.aborted ? "cancelled" : outcome ?? "completed", finishedAt: Date.now() });
      } catch (cause) {
        this.runs.set(id, {
          ...this.runs.get(id)!, finishedAt: Date.now(),
          status: controller.signal.aborted ? "cancelled" : "failed",
          ...(!controller.signal.aborted ? { error: cause instanceof Error ? cause.message : "Agent run failed." } : {})
        });
      } finally {
        this.controllers.delete(id);
        if (this.activeByConversation.get(conversationId) === id) this.activeByConversation.delete(conversationId);
        this.pruneFinished();
        this.publish();
      }
    })();
  }

  cancelConversation(conversationId: string): boolean {
    const id = this.activeByConversation.get(conversationId);
    return id ? this.cancel(id) : false;
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }
}
