import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowRight, AudioLines, Bot, Check, Clock3, FileSearch, Focus, GitBranch, Inbox, Plus, ShieldCheck, Sparkles, Trash2, Workflow, X } from "lucide-react";
import type { Conversation } from "../types";
import type { WorkspaceProject } from "../core/projects";
import { t } from "../lib/i18n";

type InboxItem = { id: string; title: string; body: string; createdAt: number; done: boolean };
type GraphNode = { id: string; label: string; kind: "idea" | "project" | "conversation" };
type WorkflowDraft = { id: string; name: string; steps: string[]; completed: number[] };
type GraphEdge = { id: string; from: string; to: string };
const INBOX_KEY = "nexus-au:studio-inbox:v1";
const GRAPH_KEY = "nexus-au:studio-graph:v1";
const WORKFLOW_KEY = "nexus-au:studio-workflows:v1";
const GRAPH_EDGE_KEY = "nexus-au:studio-graph-edges:v1";
const makeId = () => typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `nx-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const MAX_STUDIO_STORAGE_BYTES = 1_048_576;
function readList<T>(key: string, validate: (value: unknown) => value is T): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > MAX_STUDIO_STORAGE_BYTES) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 2_000) return [];
    const seen = new Set<string>();
    const result: T[] = [];
    for (const item of value) {
      if (!validate(item)) continue;
      const id = (item as { id?: unknown }).id;
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      result.push(item);
      if (result.length >= 500) break;
    }
    return result;
  } catch { return []; }
}
function saveList<T>(key: string, value: T[]) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
const isInboxItem = (value: unknown): value is InboxItem => !!value && typeof value === "object" &&
  typeof (value as InboxItem).id === "string" && (value as InboxItem).id.length <= 128 &&
  typeof (value as InboxItem).title === "string" && (value as InboxItem).title.length <= 120 &&
  typeof (value as InboxItem).body === "string" && (value as InboxItem).body.length <= 4000 &&
  typeof (value as InboxItem).createdAt === "number" && Number.isFinite((value as InboxItem).createdAt) &&
  typeof (value as InboxItem).done === "boolean";
const isGraphNode = (value: unknown): value is GraphNode => !!value && typeof value === "object" &&
  typeof (value as GraphNode).id === "string" && (value as GraphNode).id.length <= 128 &&
  typeof (value as GraphNode).label === "string" && (value as GraphNode).label.length > 0 && (value as GraphNode).label.length <= 100 &&
  ["idea", "project", "conversation"].includes((value as GraphNode).kind);
const isGraphEdge = (value: unknown): value is GraphEdge => !!value && typeof value === "object" &&
  typeof (value as GraphEdge).id === "string" && (value as GraphEdge).id.length <= 128 &&
  typeof (value as GraphEdge).from === "string" && (value as GraphEdge).from.length <= 256 &&
  typeof (value as GraphEdge).to === "string" && (value as GraphEdge).to.length <= 256 &&
  (value as GraphEdge).from !== (value as GraphEdge).to;
const isWorkflow = (value: unknown): value is WorkflowDraft => {
  if (!value || typeof value !== "object") return false;
  const workflow = value as WorkflowDraft;
  if (typeof workflow.id !== "string" || !workflow.id || workflow.id.length > 128 ||
      typeof workflow.name !== "string" || workflow.name.length > 100 ||
      !Array.isArray(workflow.steps) || workflow.steps.length === 0 || workflow.steps.length > 30 ||
      !workflow.steps.every(step => typeof step === "string" && step.length <= 240) ||
      !Array.isArray(workflow.completed) || workflow.completed.length > workflow.steps.length) return false;
  return workflow.completed.every(step => Number.isInteger(step) && step >= 0 && step < workflow.steps.length) &&
    new Set(workflow.completed).size === workflow.completed.length;
};

type Props = {
  onClose: () => void;
  conversations: Conversation[];
  projects: WorkspaceProject[];
  providerConfigured: boolean;
  providerVerified: boolean;
  nativeRuntime: boolean;
  workspaceReady: boolean;
  focusMode: boolean;
  onToggleFocus: () => void;
  onOpenAgents: () => void;
  onOpenFiles: () => void;
  onOpenKnowledge: () => void;
  onOpenTools: () => void;
  onOpenChat: () => void;
  onRunWorkflow: (task: string) => void;
};

export function WorkspaceStudio(props: Props) {
  const { conversations, projects } = props;
  const [inbox, setInbox] = useState<InboxItem[]>(() => readList(INBOX_KEY, isInboxItem));
  const [nodes, setNodes] = useState<GraphNode[]>(() => readList(GRAPH_KEY, isGraphNode));
  const [workflows, setWorkflows] = useState<WorkflowDraft[]>(() => readList(WORKFLOW_KEY, isWorkflow));
  const [edges, setEdges] = useState<GraphEdge[]>(() => readList(GRAPH_EDGE_KEY, isGraphEdge));
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [inboxQuery, setInboxQuery] = useState("");
  const [inboxFilter, setInboxFilter] = useState<"all" | "open" | "done">("all");
  const [nodeLabel, setNodeLabel] = useState("");
  const [workflowName, setWorkflowName] = useState("");
  const [workflowSteps, setWorkflowSteps] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "inbox" | "graph" | "workflows" | "analytics" | "guardian">("overview");
  const [storageWarning, setStorageWarning] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => { if (!saveList(INBOX_KEY, inbox)) setStorageWarning(t("Browser storage is unavailable or full.")); }, [inbox]);
  useEffect(() => { if (!saveList(GRAPH_KEY, nodes)) setStorageWarning(t("Browser storage is unavailable or full.")); }, [nodes]);
  useEffect(() => { if (!saveList(WORKFLOW_KEY, workflows)) setStorageWarning(t("Browser storage is unavailable or full.")); }, [workflows]);
  useEffect(() => { if (!saveList(GRAPH_EDGE_KEY, edges)) setStorageWarning(t("Browser storage is unavailable or full.")); }, [edges]);

  const analytics = useMemo(() => {
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const recent = conversations.filter(item => item.updatedAt >= sevenDaysAgo);
    const messages = conversations.reduce((sum, item) => sum + item.messages.length, 0);
    const projectConversations = conversations.filter(item => !!item.projectId).length;
    return { recent: recent.length, messages, projectConversations, projects: projects.length, total: conversations.length };
  }, [conversations, projects.length, now]);

  const contextNodes = useMemo(() => [...projects.map(item => ({ id: `project:${item.id}`, label: item.name, kind: "project" as const })), ...conversations.slice(0, 12).map(item => ({ id: `conversation:${item.id}`, label: item.title, kind: "conversation" as const })), ...nodes], [projects, conversations, nodes]);

  const filteredInbox = useMemo(() => {
    const query = inboxQuery.trim().toLocaleLowerCase();
    return inbox.filter(item => {
      const matchesStatus = inboxFilter === "all" || (inboxFilter === "open" ? !item.done : item.done);
      const matchesQuery = !query || item.title.toLocaleLowerCase().includes(query) || item.body.toLocaleLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [inbox, inboxFilter, inboxQuery]);

  const briefing = useMemo(() => {
    const latest = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
    const openItems = inbox.filter(item => !item.done).length;
    return { latest, openItems, projectCount: projects.length };
  }, [conversations, inbox, projects.length]);

  function addInboxItem() {
    const cleanTitle = title.trim().slice(0, 120);
    const cleanBody = body.trim().slice(0, 4000);
    if (!cleanTitle && !cleanBody) return;
    setInbox(current => [{ id: makeId(), title: cleanTitle || t("Untitled note"), body: cleanBody, createdAt: Date.now(), done: false }, ...current].slice(0, 500));
    setTitle(""); setBody("");
  }
  function addGraphNode() {
    const label = nodeLabel.trim().slice(0, 100);
    if (!label) return;
    setNodes(current => [...current, { id: makeId(), label, kind: "idea" as const }].slice(-200));
    setNodeLabel("");
  }
  function addGraphEdge() {
    if (!edgeFrom || !edgeTo || edgeFrom === edgeTo || edges.some(edge => edge.from === edgeFrom && edge.to === edgeTo)) return;
    setEdges(current => [...current, { id: makeId(), from: edgeFrom, to: edgeTo }].slice(-500));
  }
  function addWorkflow() {
    const name = workflowName.trim().slice(0, 100);
    const steps = workflowSteps.split("\n").map(step => step.trim().slice(0, 240)).filter(Boolean).slice(0, 30);
    if (!name || !steps.length) return;
    setWorkflows(current => [{ id: makeId(), name, steps, completed: [] }, ...current].slice(0, 100));
    setWorkflowName(""); setWorkflowSteps("");
  }
  const features = [
    { id: "briefing", icon: Clock3, title: "Daily Briefing", description: "A live summary from your actual projects, conversations and open inbox items." },
    { id: "inbox", icon: Inbox, title: "Universal Inbox", description: "Capture ideas and notes, then mark them complete or remove them." },
    { id: "graph", icon: GitBranch, title: "Knowledge Graph", description: "Build a persistent map of ideas and connect it to your workspace context." },
    { id: "workflows", icon: Workflow, title: "Workflow Studio", description: "Create reusable workflows and hand them to the approval-gated agent runtime." },
    { id: "focus", icon: Focus, title: "Focus Mode", description: "Hide distractions and keep the current task in view." },
    { id: "analytics", icon: Activity, title: "Workspace Analytics", description: "See real activity counts calculated from saved workspace data." },
    { id: "agents", icon: Bot, title: "Agent Command Center", description: "Open the existing agent runtime, approvals and execution history." },
    { id: "files", icon: FileSearch, title: "Smart File Intelligence", description: "Search and inspect approved folders through the native file system." },
    { id: "voice", icon: AudioLines, title: "Voice Control", description: "Open the chat workspace with its integrated voice controls." },
    { id: "guardian", icon: ShieldCheck, title: "System Guardian", description: "Review provider, workspace and runtime readiness without guessing." }
  ];
  function activate(id: string) {
    if (id === "inbox" || id === "graph" || id === "workflows") setActiveTab(id);
    else if (id === "focus") { props.onClose(); props.onToggleFocus(); }
    else if (id === "agents") props.onOpenAgents();
    else if (id === "files") props.onOpenFiles();
    else if (id === "voice") props.onOpenChat();
    else if (id === "analytics") setActiveTab("analytics");
    else if (id === "guardian") setActiveTab("guardian");
    else setActiveTab("overview");
  }

  return <div className="modal-backdrop studio-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section className="studio-panel" role="dialog" aria-modal="true" aria-labelledby="studio-title">
      <header className="studio-header">
        <div><span className="eyebrow">{t("PERSONAL INTELLIGENCE WORKSPACE")}</span><h2 id="studio-title">{t("NEXUS Studio")}</h2><p>{t("A connected layer for planning, capture, knowledge and system awareness.")}</p></div>
        <button className="icon-btn" onClick={props.onClose} aria-label={t("Close NEXUS Studio")}><X size={18}/></button>
      </header>
      <nav className="studio-tabs" aria-label={t("Studio sections")}>
        <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>{t("Overview")}</button>
        <button className={activeTab === "inbox" ? "active" : ""} onClick={() => setActiveTab("inbox")}>{t("Inbox")} <span>{inbox.filter(item => !item.done).length}</span></button>
        <button className={activeTab === "graph" ? "active" : ""} onClick={() => setActiveTab("graph")}>{t("Knowledge Graph")}</button>
        <button className={activeTab === "workflows" ? "active" : ""} onClick={() => setActiveTab("workflows")}>{t("Workflows")}</button>
        <button className={activeTab === "analytics" ? "active" : ""} onClick={() => setActiveTab("analytics")}>{t("Analytics")}</button>
        <button className={activeTab === "guardian" ? "active" : ""} onClick={() => setActiveTab("guardian")}>{t("Guardian")}</button>
      </nav>
      {storageWarning && <p className="studio-warning" role="status">{storageWarning}</p>}
      {activeTab === "overview" && <>
        <section className="studio-briefing">
          <div className="studio-section-kicker"><Sparkles size={14}/> {t("LIVE WORKSPACE BRIEFING")}</div>
          <h3>{t("Your workspace at a glance")}</h3>
          <div className="studio-briefing-grid">
            <article><strong>{briefing.openItems}</strong><span>{t("Open inbox items")}</span></article>
            <article><strong>{briefing.projectCount}</strong><span>{t("Projects")}</span></article>
            <article><strong>{briefing.latest.length}</strong><span>{t("Recent conversations")}</span></article>
          </div>
          {briefing.latest.length ? <ul>{briefing.latest.map(item => <li key={item.id}><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleString()}</small></li>)}</ul> : <p>{t("Start a conversation to populate your briefing.")}</p>}
        </section>
        <section className="studio-feature-grid">
          {features.map(feature => { const Icon = feature.icon; return <button key={feature.id} className="studio-feature" onClick={() => activate(feature.id)}>
            <span className="studio-feature-icon"><Icon size={18}/></span><strong>{t(feature.title)}</strong><small>{t(feature.description)}</small><span className="studio-feature-open">{feature.id === "focus" && props.focusMode ? t("Active") : t("Open")} <ArrowRight size={13}/></span>
          </button>; })}
        </section>
      </>}
      {activeTab === "analytics" && <section className="studio-content">
        <div className="studio-section-kicker"><Activity size={14}/> {t("WORKSPACE TELEMETRY")}</div><h3>{t("Workspace Analytics")}</h3>
        <div className="studio-briefing-grid">
          <article><strong>{analytics.total}</strong><span>{t("Saved conversations")}</span></article>
          <article><strong>{analytics.messages}</strong><span>{t("Messages across history")}</span></article>
          <article><strong>{analytics.recent}</strong><span>{t("Conversations updated in 7 days")}</span></article>
          <article><strong>{analytics.projects}</strong><span>{t("Projects")}</span></article>
          <article><strong>{analytics.projectConversations}</strong><span>{t("Project-linked conversations")}</span></article>
          <article><strong>{inbox.length}</strong><span>{t("Captured inbox items")}</span></article>
        </div>
        <p className="studio-note">{t("Metrics are calculated from locally saved workspace records; no activity is sent to an analytics service.")}</p>
      </section>}
      {activeTab === "guardian" && <section className="studio-content">
        <div className="studio-section-kicker"><ShieldCheck size={14}/> {t("SYSTEM HEALTH CHECK")}</div><h3>{t("System Guardian")}</h3>
        <div className="studio-health-list">
          <article data-ready={props.workspaceReady}><span/><div><strong>{t("Workspace data")}</strong><small>{props.workspaceReady ? t("Conversation storage is loaded.") : t("Workspace storage is still loading.")}</small></div><b>{props.workspaceReady ? t("READY") : t("LOADING")}</b></article>
          <article data-ready={props.providerConfigured}><span/><div><strong>{t("AI provider configuration")}</strong><small>{props.providerVerified ? t("A generation test passed in this session.") : props.providerConfigured ? t("A provider is configured but not verified.") : t("No provider is configured.")}</small></div><b>{props.providerVerified ? t("VERIFIED") : props.providerConfigured ? t("UNVERIFIED") : t("MISSING")}</b></article>
          <article data-ready={props.nativeRuntime}><span/><div><strong>{t("Native integrations")}</strong><small>{props.nativeRuntime ? t("Desktop runtime detected; device permissions still apply.") : t("Browser preview cannot access native file and credential services.")}</small></div><b>{props.nativeRuntime ? t("DESKTOP") : t("PREVIEW")}</b></article>
        </div>
        <button className="secondary-btn" onClick={props.onOpenTools}>{t("Inspect connected tools and permissions")}</button>
        <p className="studio-note">{t("Guardian reports only states the application can observe. It does not claim that an untested provider or external service is healthy.")}</p>
      </section>}
      {activeTab === "inbox" && <section className="studio-content">
        <div className="studio-section-kicker"><Inbox size={14}/> {t("CAPTURE CENTER")}</div><h3>{t("Universal Inbox")}</h3>
        <div className="studio-form"><input aria-label={t("Inbox title")} value={title} onChange={event => setTitle(event.target.value)} placeholder={t("Short title")}/><textarea aria-label={t("Inbox note")} value={body} onChange={event => setBody(event.target.value)} placeholder={t("Capture an idea, link or note…")} rows={3}/><button className="primary-btn" onClick={addInboxItem} disabled={!title.trim() && !body.trim()}><Plus size={15}/> {t("Save to inbox")}</button></div>
        <div className="studio-inbox-tools">
          <input aria-label={t("Search inbox")} value={inboxQuery} onChange={event => setInboxQuery(event.target.value)} placeholder={t("Search saved notes…")}/>
          <div role="group" aria-label={t("Inbox filters")}>
            <button className={inboxFilter === "all" ? "active" : ""} onClick={() => setInboxFilter("all")}>{t("All")} ({inbox.length})</button>
            <button className={inboxFilter === "open" ? "active" : ""} onClick={() => setInboxFilter("open")}>{t("Open")} ({inbox.filter(item => !item.done).length})</button>
            <button className={inboxFilter === "done" ? "active" : ""} onClick={() => setInboxFilter("done")}>{t("Completed")} ({inbox.filter(item => item.done).length})</button>
          </div>
        </div>
        <div className="studio-list">{filteredInbox.map(item => <article key={item.id} className={item.done ? "done" : ""}><button className="studio-check" onClick={() => setInbox(current => current.map(entry => entry.id === item.id ? { ...entry, done: !entry.done } : entry))} aria-label={item.done ? t("Mark as open") : t("Mark as complete")}><Check size={15}/></button><div><strong>{item.title}</strong>{item.body && <p>{item.body}</p>}<small>{new Date(item.createdAt).toLocaleString()}</small></div><button className="icon-btn" onClick={() => setInbox(current => current.filter(entry => entry.id !== item.id))} aria-label={t("Delete inbox item")}><Trash2 size={15}/></button></article>)}</div>
        {!inbox.length && <p className="studio-empty">{t("Your inbox is empty. Capture something worth keeping.")}</p>}
        {inbox.length > 0 && !filteredInbox.length && <p className="studio-empty">{t("No inbox items match this filter.")}</p>}
      </section>}
      {activeTab === "graph" && <section className="studio-content">
        <div className="studio-section-kicker"><GitBranch size={14}/> {t("CONNECTED KNOWLEDGE")}</div><h3>{t("Knowledge Graph")}</h3>
        <p>{t("Add concepts and see how they relate to the workspace. Existing projects and conversations are shown as context nodes.")}</p>
        <div className="studio-form studio-inline-form"><input aria-label={t("New knowledge node")} value={nodeLabel} onChange={event => setNodeLabel(event.target.value)} placeholder={t("Add a concept or idea")}/><button className="primary-btn" onClick={addGraphNode} disabled={!nodeLabel.trim()}><Plus size={15}/> {t("Add node")}</button></div>
        <div className="studio-graph">
          {contextNodes.map(node => <article key={node.id} data-kind={node.kind}><span/><strong>{node.label}</strong><small>{t(node.kind)}</small>{node.kind === "idea" && <button onClick={() => setNodes(current => current.filter(item => item.id !== node.id))} aria-label={t("Remove node")}><X size={13}/></button>}</article>)}
        </div>
        <div className="studio-edge-builder"><select aria-label={t("Relationship source")} value={edgeFrom} onChange={event => setEdgeFrom(event.target.value)}><option value="">{t("Choose first node")}</option>{contextNodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select><select aria-label={t("Relationship target")} value={edgeTo} onChange={event => setEdgeTo(event.target.value)}><option value="">{t("Choose related node")}</option>{contextNodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}</select><button className="secondary-btn" onClick={addGraphEdge} disabled={!edgeFrom || !edgeTo || edgeFrom === edgeTo}>{t("Connect nodes")}</button></div>
        <div className="studio-edge-list">{edges.map(edge => { const from = contextNodes.find(node => node.id === edge.from); const to = contextNodes.find(node => node.id === edge.to); return from && to ? <article key={edge.id}><span>{from.label}</span><ArrowRight size={13}/><span>{to.label}</span><button onClick={() => setEdges(current => current.filter(item => item.id !== edge.id))} aria-label={t("Remove relationship")}><X size={13}/></button></article> : null; })}</div>
        <button className="secondary-btn" onClick={props.onOpenKnowledge}>{t("Open full knowledge base")}</button>
        <p className="studio-note">{t("Workspace context is read-only here; personal idea nodes are saved locally on this device.")}</p>
      </section>}
      {activeTab === "workflows" && <section className="studio-content">
        <div className="studio-section-kicker"><Workflow size={14}/> {t("REPEATABLE PROCESSES")}</div><h3>{t("Workflow Studio")}</h3>
        <div className="studio-form"><input aria-label={t("Workflow name")} value={workflowName} onChange={event => setWorkflowName(event.target.value)} placeholder={t("Workflow name")}/><textarea aria-label={t("Workflow steps")} value={workflowSteps} onChange={event => setWorkflowSteps(event.target.value)} placeholder={t("One step per line")} rows={4}/><button className="primary-btn" onClick={addWorkflow} disabled={!workflowName.trim() || !workflowSteps.trim()}><Plus size={15}/> {t("Create workflow")}</button></div>
        <div className="studio-list">{workflows.map(workflow => <article key={workflow.id}><div className="studio-workflow-main"><strong>{workflow.name}</strong><small>{workflow.completed.length}/{workflow.steps.length} {t("steps completed")}</small><button className="secondary-btn" type="button" onClick={() => props.onRunWorkflow(["Workflow: " + workflow.name, "Use the NEXUS agent to work through this workflow one step at a time.", "Treat the following checklist as the owner's goal, not as permission to perform actions.", ...workflow.steps.map((step, index) => (index + 1) + ". " + step), "Ask for approval before any external or filesystem action. Report completed and blocked steps honestly."].join("\n"))}>{t("Prepare agent run")}</button><ol>{workflow.steps.map((step, index) => <li key={index}><label><input type="checkbox" checked={workflow.completed.includes(index)} onChange={event => setWorkflows(current => current.map(item => item.id === workflow.id ? { ...item, completed: event.target.checked ? [...item.completed, index] : item.completed.filter(value => value !== index) } : item))}/>{step}</label></li>)}</ol></div><button className="icon-btn" onClick={() => setWorkflows(current => current.filter(item => item.id !== workflow.id))} aria-label={t("Delete workflow")}><Trash2 size={15}/></button></article>)}</div>
        {!workflows.length && <p className="studio-empty">{t("Create a reusable checklist for a process you repeat.")}</p>}
        <p className="studio-note">{t("Workflow checklists can be handed to the agent. The agent still needs explicit approval before external or filesystem actions.")}</p>
      </section>}
      <footer className="studio-footer">
        <span><ShieldCheck size={14}/> {t("LOCAL WORKSPACE DATA")}</span>
        <span>{t("AI provider")}: {props.providerVerified ? t("Verified") : props.providerConfigured ? t("Configured, not verified") : t("Not configured")}</span>
        <span>{props.nativeRuntime ? t("Desktop runtime") : t("Browser preview")}</span>
      </footer>
    </section>
  </div>;
}
