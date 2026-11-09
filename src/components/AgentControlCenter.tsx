import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, Bot, Check, Clock3, Play, RefreshCw, Shield, Sparkles, X } from "lucide-react";
import type { AgentCheckpoint } from "../core/agentCheckpoints";
import type { AgentRunId } from "../core/agents";
import type { ProviderSettings } from "../types";
import { createTauriModelRouter, NATIVE_MODEL_PROVIDER_ID } from "../lib/tauriModelProvider";
import { TOOL_INVOCATION_AGENT_ID } from "../core/toolInvocationAgent";
import type { ResumableAgentEvent } from "../core/resumableAgents";
import { createWorkspaceNexusRuntime } from "../lib/nexusRuntime";
import { BUILT_IN_AGENT_CATALOG, BUILT_IN_AGENT_IDS, createLocalWorkflowDefinition, registerBuiltInAgentSuite } from "../lib/agentCatalog";
import { DEFAULT_AGENT_PROFILE, loadAgentProfile, saveAgentProfile, validateAgentProfile, type AgentProfile } from "../lib/agentProfile";

const THREAD_ID = "nexus-agent-control-center";

type RuntimeBundle = ReturnType<typeof createWorkspaceNexusRuntime>;
type RuntimeState = { runtime: RuntimeBundle | null; error: string; profile: AgentProfile | null };
type FeedItem = { id: number; tone: "normal" | "success" | "warning" | "error"; text: string };

function taskFromCheckpoint(checkpoint: AgentCheckpoint): string {
  if (!checkpoint.state || typeof checkpoint.state !== "object" || Array.isArray(checkpoint.state) || !("payload" in checkpoint.state)) return "Task details unavailable";
  const payload = checkpoint.state.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("task" in payload) || typeof payload.task !== "string") return "Task details unavailable";
  return payload.task;
}

function savedOutputFromCheckpoint(checkpoint: AgentCheckpoint): string | null {
  if (!checkpoint.state || typeof checkpoint.state !== "object" || Array.isArray(checkpoint.state) || !("payload" in checkpoint.state)) return null;
  const payload = checkpoint.state.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !("preview" in payload) || typeof payload.preview !== "string") return null;
  return payload.preview;
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

export function AgentControlCenter({ onClose, providerSettings, hasProviderKey }: { onClose: () => void; providerSettings: ProviderSettings; hasProviderKey: boolean }) {
  const [runtimeState] = useState<RuntimeState>(() => {
    try {
      const loadedProfile = loadAgentProfile(window.localStorage);
      if (!loadedProfile.ok) throw new Error(loadedProfile.error.message);
      const models = hasProviderKey ? createTauriModelRouter(providerSettings) : null;
      const runtime = createWorkspaceNexusRuntime("local-user", {
        authorizeAgent: async ({ agentId }) => agentId === BUILT_IN_AGENT_IDS.localWorkflow ? "ask_user" : agentId === TOOL_INVOCATION_AGENT_ID ? "allow" : "deny",
        authorizeTool: async () => "deny"
      }, models ?? undefined);
      const registered = registerBuiltInAgentSuite(runtime, loadedProfile.value);
      if (!registered.ok) throw new Error(registered.error.message);
      return { runtime, error: "", profile: loadedProfile.value };
    } catch (cause) {
      return { runtime: null, error: cause instanceof Error ? cause.message : "Could not initialize the local agent runtime.", profile: null };
    }
  });
  const [task, setTask] = useState("");
  const [profile, setProfile] = useState<AgentProfile>(runtimeState.profile ?? DEFAULT_AGENT_PROFILE);
  const [checkpoints, setCheckpoints] = useState<AgentCheckpoint[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const feedSequence = useRef(0);
  const runtime = runtimeState.runtime;
  const plannedWorkflow = useMemo(() => runtime?.createAgentWorkflow(NATIVE_MODEL_PROVIDER_ID, providerSettings.model, THREAD_ID + "-planned") ?? null, [runtime, providerSettings.model]);
  const registeredAgents = runtime?.agentRuntime.list() ?? [];

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
  useEffect(() => () => { controller.current?.abort(); }, []);

  async function consume(events: AsyncIterable<ResumableAgentEvent>) {
    for await (const event of events) {
      if (runtime) {
        const status = event.type === "started" ? "started" : event.type === "progress" || event.type === "output" ? "progress" : event.type === "waiting_for_approval" ? "waiting_for_approval" : event.type === "completed" ? "completed" : "failed";
        await runtime.traceSink.append({ traceId: event.runId, runId: event.runId, name: "agent.run", status, timestamp: Date.now(), ...(event.type === "completed" ? { durationMs: 0 } : {}), attributes: { event: event.type } });
      }
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

  function saveProfile() {
    if (!runtime || busy) return;
    if (checkpoints.some(item => item.status === "running" || item.status === "waiting_for_approval")) {
      addFeed("Finish or reject active runs before changing the agent version.", "warning");
      return;
    }
    const next: AgentProfile = { ...profile, name: profile.name.trim(), revision: profile.revision + 1, updatedAt: Date.now() };
    const validation = validateAgentProfile(next);
    if (validation) { addFeed(validation, "error"); return; }
    const replaced = runtime.agentRuntime.replace(createLocalWorkflowDefinition(next));
    if (!replaced.ok) { addFeed(replaced.error.message, "error"); return; }
    const saved = saveAgentProfile(window.localStorage, next);
    if (!saved.ok) {
      runtime.agentRuntime.replace(createLocalWorkflowDefinition(profile));
      addFeed(saved.error.message, "error");
      return;
    }
    setProfile(next);
    addFeed("Agent profile saved as version 1." + next.revision + ".0.", "success");
  }

  async function startPlannedWorkflow() {
    if (!runtime || !plannedWorkflow || !task.trim() || busy) return;
    const goal = task.trim();
    if (!window.confirm("Send this task to your configured AI provider? The planner may execute only the built-in local preview tool. No external tool or system action is permitted.")) return;
    setTask("");
    setFeed([]);
    const nextController = new AbortController();
    controller.current = nextController;
    setBusy(true);
    try {
      addFeed("Sending the task to the configured model planner…");
      const planned = await plannedWorkflow.plan(goal, nextController.signal);
      if (!planned.ok) {
        addFeed("Planning failed: " + planned.error.message, "error");
        return;
      }
      addFeed("Validated plan: " + planned.value.steps.length + " bounded tool step(s).", "success");
      const coordinationId = crypto.randomUUID() as AgentRunId;
      setActiveRunId(coordinationId);
      for await (const event of plannedWorkflow.run(planned.value, coordinationId, nextController.signal)) {
        if (event.type === "started") addFeed("Planned workflow started: " + event.runId);
        else if (event.type === "agent_started") addFeed("Executing step " + event.step + " with " + event.agentId + "…");
        else if (event.type === "agent_completed") addFeed("Step " + event.step + " completed.", "success");
        else if (event.type === "waiting_for_approval") addFeed("Approval required for step " + event.step + ".", "warning");
        else if (event.type === "completed") addFeed(event.detail ?? "Planned workflow completed.", "success");
        else if (event.type === "failed") addFeed(event.detail ?? "Planned workflow failed.", "error");
      }
      await refresh();
    } catch (cause) {
      addFeed(cause instanceof Error ? cause.message : "Planned workflow failed.", "error");
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
            <div className="agent-card-heading"><div><span className="agent-kicker">AVAILABLE AGENTS · {registeredAgents.length}</span><h3>{registeredAgents[0]?.name ?? BUILT_IN_AGENT_CATALOG[0].name}</h3></div><span className="agent-local-tag">LOCAL DEMO</span></div>
            <p>{registeredAgents[0]?.description ?? BUILT_IN_AGENT_CATALOG[0].description}</p>
            <div className="agent-metadata">
              <span><Activity size={13}/> {registeredAgents[0]?.maxSteps ?? 3} max steps</span>
              <span><Clock3 size={13}/> {Math.round((registeredAgents[0]?.timeoutMs ?? 15_000) / 1_000)} sec limit</span>
              <span><Shield size={13}/> {(registeredAgents[0]?.requiredPermissions ?? []).join(", ") || "No permissions"}</span>
            </div>
            <label className="agent-task-label" htmlFor="agent-task">Task input</label>
            <textarea id="agent-task" value={task} onChange={event => setTask(event.target.value)} maxLength={1_000} rows={3} placeholder="Describe a task for the local workflow preview…"/>
            <div className="agent-form-footer"><span>{task.length}/1000 characters</span><div className="agent-run-actions"><button className="agent-primary-button" disabled={!runtime || busy || !task.trim()} onClick={startAgent}><Play size={14}/> Run demo</button><button className="agent-small-button" disabled={!plannedWorkflow || busy || !task.trim()} onClick={() => void startPlannedWorkflow()} title={plannedWorkflow ? "Create a model plan and execute registered tools through the permission-gated runtime" : "Save a provider API key in Settings to enable AI planning"}><Sparkles size={14}/> Plan with AI</button></div></div>
            <div className="agent-disclaimer">The demo agent creates a local preview. The AI planner uses your configured provider and can execute only registered tools through the permission-gated runtime; unapproved external tools remain blocked.</div>
          </article>

          <article className="agent-card">
            <div className="agent-card-heading"><div><span className="agent-kicker">AGENT CONFIGURATION</span><h3>Profile settings</h3></div><span className="agent-local-tag">V1.{profile.revision}.0</span></div>
            <label className="agent-task-label" htmlFor="agent-name">Display name</label>
            <input id="agent-name" className="agent-profile-input" value={profile.name} maxLength={80} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))}/>
            <div className="agent-profile-fields">
              <label>Maximum steps<input type="number" min={1} max={20} value={profile.maxSteps} onChange={event => setProfile(current => ({ ...current, maxSteps: Number(event.target.value) }))}/></label>
              <label>Timeout (seconds)<input type="number" min={1} max={60} value={Math.round(profile.timeoutMs / 1_000)} onChange={event => setProfile(current => ({ ...current, timeoutMs: Number(event.target.value) * 1_000 }))}/></label>
            </div>
            <div className="agent-form-footer"><span>Permission requirement stays fixed: tool:execute</span><button className="agent-small-button" disabled={!runtime || busy || !profile.name.trim() || profile.maxSteps < 1 || profile.maxSteps > 20 || profile.timeoutMs < 1_000 || profile.timeoutMs > 60_000} onClick={saveProfile}>Save profile</button></div>
            <div className="agent-disclaimer">Changing the profile creates a new agent version. Finish or reject active runs first; older checkpoints cannot resume on a different version.</div>
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
                {savedOutputFromCheckpoint(checkpoint) && <details className="agent-saved-output"><summary>View saved result</summary><pre>{savedOutputFromCheckpoint(checkpoint)}</pre></details>}
                {checkpoint.status === "running" && <button className="agent-small-button" disabled={busy} onClick={() => continueRun(checkpoint)}>Continue checkpoint</button>}
              </div>)}</div>}
          </article>
        </aside>
      </div>
      <footer className="agent-center-footer"><span>Storage: native SQLite checkpoints, audit and traces · approval grants: one-time</span><span>Default-deny tool policy</span></footer>
    </section>
  </div>;
}
