import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, Bot, Check, Clock3, Play, RefreshCw, Shield, X } from "lucide-react";
import type { AgentCheckpoint } from "../core/agentCheckpoints";
import type { AgentRunId } from "../core/agents";
import type { ResumableAgentEvent } from "../core/resumableAgents";
import { createBrowserNexusRuntime } from "../lib/nexusRuntime";
import { BUILT_IN_AGENT_CATALOG, BUILT_IN_AGENT_IDS, registerBuiltInAgentSuite } from "../lib/agentCatalog";

const THREAD_ID = "nexus-agent-control-center";

type RuntimeBundle = ReturnType<typeof createBrowserNexusRuntime>;
type RuntimeState = { runtime: RuntimeBundle | null; error: string };
type FeedItem = { id: number; tone: "normal" | "success" | "warning" | "error"; text: string };

function taskFromCheckpoint(checkpoint: AgentCheckpoint): string {
  if (!checkpoint.state || typeof checkpoint.state !== "object" || Array.isArray(checkpoint.state) || !("payload" in checkpoint.state)) return "Task details unavailable";
  const payload = checkpoint.state.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("task" in payload) || typeof payload.task !== "string") return "Task details unavailable";
  return payload.task;
}

function statusLabel(status: AgentCheckpoint["status"]): string {
  const labels: Record<AgentCheckpoint["status"], string> = {
    running: "Running",
    waiting_for_approval: "Waiting for approval",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled"
  };
  return labels[status];
}

export function AgentControlCenter({ onClose }: { onClose: () => void }) {
  const [runtimeState] = useState<RuntimeState>(() => {
    try {
      const runtime = createBrowserNexusRuntime("local-user", {
        authorizeAgent: async () => "ask_user",
        authorizeTool: async () => "deny"
      });
      const registered = registerBuiltInAgentSuite(runtime);
      if (!registered.ok) throw new Error(registered.error.message);
      return { runtime, error: "" };
    } catch (cause) {
      return { runtime: null, error: cause instanceof Error ? cause.message : "Could not initialize the local agent runtime." };
    }
  });
  const [task, setTask] = useState("");
  const [checkpoints, setCheckpoints] = useState<AgentCheckpoint[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const feedSequence = useRef(0);
  const runtime = runtimeState.runtime;

  const addFeed = useCallback((text: string, tone: FeedItem["tone"] = "normal") => {
    feedSequence.current += 1;
    setFeed(current => [...current, { id: feedSequence.current, text, tone }].slice(-80));
  }, []);

  const refresh = useCallback(async () => {
    if (!runtime) return;
    const result = await runtime.checkpointService.listByThread(THREAD_ID, 50);
    if (result.ok) setCheckpoints(result.value);
    else addFeed(result.error.message, "error");
  }, [runtime, addFeed]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function consume(events: AsyncIterable<ResumableAgentEvent>) {
    for await (const event of events) {
      if (event.type === "started") {
        setActiveRunId(event.runId);
        addFeed("Agent run started: " + event.runId);
      } else if (event.type === "progress") {
        addFeed("Step " + event.step + "/" + event.maxSteps + ": " + event.label);
      } else if (event.type === "output") {
        addFeed(event.content, "success");
      } else if (event.type === "waiting_for_approval") {
        addFeed("Approval required: " + event.permission, "warning");
      } else if (event.type === "completed") {
        addFeed("Run completed in " + event.steps + " step(s).", "success");
      } else if (event.type === "failed") {
        addFeed(event.message, "error");
      }
    }
    await refresh();
  }

  async function runAction(action: () => AsyncIterable<ResumableAgentEvent>) {
    if (!runtime || busy) return;
    const nextController = new AbortController();
    controller.current = nextController;
    setBusy(true);
    try {
      await consume(action());
    } catch (cause) {
      addFeed(cause instanceof Error ? cause.message : "Agent execution failed.", "error");
      await refresh();
    } finally {
      controller.current = null;
      setBusy(false);
      setActiveRunId(null);
      await refresh();
    }
  }

  function startAgent() {
    if (!runtime || !task.trim() || task.trim().length > 1_000) return;
    const input = task.trim();
    setTask("");
    setFeed([]);
    void runAction(() => runtime.agentRuntime.start(BUILT_IN_AGENT_IDS.localWorkflow, input, THREAD_ID, controller.current?.signal));
  }

  function approve(checkpoint: AgentCheckpoint) {
    if (!runtime) return;
    void runAction(async function* () {
      const grant = await runtime.issueApproval(checkpoint.runId as AgentRunId);
      if (!grant.ok) {
        yield { type: "failed", runId: checkpoint.runId as AgentRunId, message: grant.error.message } as ResumableAgentEvent;
        return;
      }
      yield* runtime.agentRuntime.resume(checkpoint.runId as AgentRunId, grant.value, controller.current?.signal);
    });
  }

  async function reject(checkpoint: AgentCheckpoint) {
    if (!runtime || checkpoint.status !== "waiting_for_approval") return;
    const rejected: AgentCheckpoint = {
      ...checkpoint,
      sequence: checkpoint.sequence + 1,
      status: "failed",
      updatedAt: Date.now()
    };
    delete rejected.pendingApproval;
    const result = await runtime.checkpointService.persist(rejected);
    if (!result.ok) addFeed(result.error.message, "error");
    else addFeed("Approval rejected. The run was closed without executing the tool.", "warning");
    await refresh();
  }

  function continueRun(checkpoint: AgentCheckpoint) {
    if (!runtime) return;
    void runAction(() => runtime.agentRuntime.continue(checkpoint.runId as AgentRunId, controller.current?.signal));
  }

  return <div className="agent-backdrop" role="dialog" aria-modal="true" aria-labelledby="agent-center-title">
    <section className="agent-center">
      <header className="agent-center-header">
        <div className="agent-center-title">
          <div className="agent-center-icon"><Bot size={20}/></div>
          <div><div className="eyebrow">NEXUS AU / CONTROL PLANE</div><h2 id="agent-center-title">Agent Control Center</h2><p>Bounded execution, explicit approvals, checkpoints and audit.</p></div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close agent control center"><X size={18}/></button>
      </header>

      {runtimeState.error && <div className="agent-error"><AlertTriangle size={16}/>{runtimeState.error}</div>}

      <div className="agent-center-grid">
        <section className="agent-main-column">
          <article className="agent-card">
            <div className="agent-card-heading"><div><span className="agent-kicker">AVAILABLE AGENT</span><h3>{BUILT_IN_AGENT_CATALOG[0].name}</h3></div><span className="agent-local-tag">LOCAL DEMO</span></div>
            <p>{BUILT_IN_AGENT_CATALOG[0].description}</p>
            <div className="agent-metadata">
              <span><Activity size={13}/> {BUILT_IN_AGENT_CATALOG[0].maxSteps} max steps</span>
              <span><Clock3 size={13}/> 15 sec limit</span>
              <span><Shield size={13}/> Approval required</span>
            </div>
            <label className="agent-task-label" htmlFor="agent-task">Task input</label>
            <textarea id="agent-task" value={task} onChange={event => setTask(event.target.value)} maxLength={1_000} rows={3} placeholder="Describe a task for the local workflow preview…"/>
            <div className="agent-form-footer"><span>{task.length}/1000 characters</span><button className="agent-primary-button" disabled={!runtime || busy || !task.trim()} onClick={startAgent}><Play size={14}/> Run agent</button></div>
            <div className="agent-disclaimer">This built-in agent is a deterministic integration demo, not an LLM agent. It creates a local preview only and has no external system access.</div>
          </article>

          <article className="agent-card">
            <div className="agent-card-heading"><div><span className="agent-kicker">LIVE EXECUTION</span><h3>Run event stream</h3></div><button className="agent-small-button" onClick={() => void refresh()} disabled={!runtime}><RefreshCw size={13}/> Refresh</button></div>
            {feed.length === 0 ? <div className="agent-empty">Start a run to inspect progress, approval handoffs and output.</div> : <div className="agent-feed">{feed.map(item => <div className={"agent-feed-item " + item.tone} key={item.id}><span className="agent-feed-dot"/><pre>{item.text}</pre></div>)}</div>}
            {busy && <button className="agent-danger-button" onClick={() => controller.current?.abort()}><X size={13}/> Cancel active run</button>}
            {activeRunId && <span className="agent-active-id">Active run: {activeRunId}</span>}
          </article>
        </section>

        <aside className="agent-side-column">
          <article className="agent-card agent-approval-card">
            <div className="agent-card-heading"><div><span className="agent-kicker">HUMAN IN THE LOOP</span><h3>Approval queue</h3></div><span className="agent-count">{checkpoints.filter(item => item.status === "waiting_for_approval").length}</span></div>
            {checkpoints.filter(item => item.status === "waiting_for_approval").length === 0 ? <div className="agent-empty">No pending approvals.</div> :
              checkpoints.filter(item => item.status === "waiting_for_approval").map(checkpoint => <div className="agent-approval-item" key={checkpoint.runId}>
                <strong>{checkpoint.pendingApproval?.permission}</strong><p>{taskFromCheckpoint(checkpoint)}</p><small>Run {checkpoint.runId}</small>
                <div className="agent-approval-actions"><button onClick={() => approve(checkpoint)} disabled={busy}><Check size={13}/> Approve once</button><button onClick={() => void reject(checkpoint)} disabled={busy}>Reject</button></div>
              </div>)}
          </article>

          <article className="agent-card">
            <div className="agent-card-heading"><div><span className="agent-kicker">PERSISTED CHECKPOINTS</span><h3>Run history</h3></div><span className="agent-count">{checkpoints.length}</span></div>
            {checkpoints.length === 0 ? <div className="agent-empty">No saved runs yet.</div> :
              <div className="agent-history">{checkpoints.map(checkpoint => <div className="agent-history-item" key={checkpoint.runId}>
                <div className="agent-history-top"><span className={"agent-status " + checkpoint.status}>{statusLabel(checkpoint.status)}</span><time>{new Date(checkpoint.updatedAt).toLocaleString()}</time></div>
                <p>{taskFromCheckpoint(checkpoint)}</p><small>{checkpoint.runId} · checkpoint #{checkpoint.sequence}</small>
                {checkpoint.status === "running" && <button className="agent-small-button" disabled={busy} onClick={() => continueRun(checkpoint)}>Continue checkpoint</button>}
              </div>)}</div>}
          </article>
        </aside>
      </div>
      <footer className="agent-center-footer"><span>Storage: browser localStorage preview · approval grants: in-memory and one-time</span><span>Default-deny tool policy</span></footer>
    </section>
  </div>;
}
