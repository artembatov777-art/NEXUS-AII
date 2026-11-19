import { summarizeRuns } from "./agentRunSummary";
import { validAgentRunIdentity } from "./agentRunIdentity";
/**
 * Owns the lifetime of foreground agent tasks independently of React panels.
 * UI subscribers may mount/unmount without cancelling the underlying task.
 */
export type ManagedRunStatus = "running" | "completed" | "failed" | "cancelled";
export interface ManagedRun {
  id: string;
  conversationId: string;
  status: ManagedRunStatus;
  error?: string;
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

export class AgentRunManager {
  private readonly runs = new Map<string, ManagedRun>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<ManagedRunListener>();
  private readonly activeByConversation = new Map<string, string>();
  private readonly events = new Map<string, ManagedRunEvent[]>();

  list(conversationId?: string): ManagedRun[] {
    return [...this.runs.values()]
      .filter(run => conversationId === undefined || run.conversationId === conversationId)
      .map(run => ({ ...run }));
  }

  summary(conversationId?: string) {
    return summarizeRuns(this.list(), conversationId);
  }

  activeRun(conversationId: string): ManagedRun | null {
    const id = this.activeByConversation.get(conversationId);
    const run = id ? this.runs.get(id) : undefined;
    return run ? { ...run } : null;
  }

  history(runId: string): ManagedRunEvent[] {
    return (this.events.get(runId) ?? []).map(event => ({ ...event }));
  }

  appendEvent(runId: string, kind: ManagedRunEvent["kind"], message: string): void {
    const run = this.runs.get(runId);
    if (!run) throw new Error("Unknown run ID.");
    const events = this.events.get(runId) ?? [];
    events.push({ runId, conversationId: run.conversationId, timestamp: Date.now(), kind, message });
    this.events.set(runId, events.slice(-200));
    this.publish();
  }

  subscribe(listener: ManagedRunListener): () => void {
    this.listeners.add(listener);
    listener(this.list());
    return () => { this.listeners.delete(listener); };
  }

  private publish(): void {
    const snapshot = this.list();
    for (const listener of [...this.listeners]) listener(snapshot);
  }

  start(id: string, conversationId: string, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
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
        await task(controller.signal);
        this.runs.set(id, { id, conversationId, status: controller.signal.aborted ? "cancelled" : "completed", startedAt: this.runs.get(id)!.startedAt, finishedAt: Date.now() });
      } catch (cause) {
        this.runs.set(id, {
          id, conversationId, startedAt: this.runs.get(id)!.startedAt, finishedAt: Date.now(),
          status: controller.signal.aborted ? "cancelled" : "failed",
          ...(!controller.signal.aborted ? { error: cause instanceof Error ? cause.message : "Agent run failed." } : {})
        });
      } finally {
        this.controllers.delete(id);
        if (this.activeByConversation.get(conversationId) === id) this.activeByConversation.delete(conversationId);
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
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
