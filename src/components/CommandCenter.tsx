import { Activity, BookOpen, Bot, Command, FolderKanban, FolderOpen, MemoryStick, Plug, Settings2, Sparkles, Zap } from "lucide-react";

type CommandCenterProps = {
  projectCount: number;
  conversationCount: number;
  model: string;
  route: "remote" | "local";
  providerReady: boolean;
  providerConnection: "unchecked" | "checking" | "reachable" | "failed";
  credentialVault: "loading" | "available" | "missing" | "unavailable" | "browser";
  workspaceReady: boolean;
  busy: boolean;
  recentActivity: Array<{ id: string; title: string; updatedAt: number; messageCount: number }>;
  onOpenAgents: () => void;
  onOpenMemory: () => void;
  onOpenKnowledge: () => void;
  onOpenProjects: () => void;
  onOpenFiles: () => void;
  onOpenTools: () => void;
  onOpenSettings: () => void;
  onStartPlanning: () => void;
};

export function CommandCenter({
  projectCount, conversationCount, model, route, providerReady, providerConnection, credentialVault, workspaceReady, busy, recentActivity,
  onOpenAgents, onOpenMemory, onOpenKnowledge, onOpenProjects,
  onOpenFiles, onOpenTools, onOpenSettings, onStartPlanning
}: CommandCenterProps) {
  const status = busy ? "PROCESSING" : providerReady ? "READY" : "STANDBY";
  return <section className="command-center" aria-label="NEXUS command center">
    <div className="command-center-heading">
      <div><span className="command-kicker"><Activity size={12}/> COMMAND CENTER</span><h2>System overview</h2><p>Live workspace status and direct access to your tools.</p></div>
      <div className={`command-status ${busy ? "is-busy" : providerReady ? "is-ready" : "is-idle"}`}><i/>{status}</div>
    </div>
    <div className="command-metrics">
      <article><span>MODEL ROUTE</span><strong>{route === "remote" ? "REMOTE" : "LOCAL*"}</strong><small>{model || "No model selected"}</small></article>
      <article><span>PROJECTS</span><strong>{projectCount.toLocaleString()}</strong><small>Workspace projects</small></article>
      <article><span>CONVERSATIONS</span><strong>{conversationCount.toLocaleString()}</strong><small>Saved conversations</small></article>
      <article><span>AI PROVIDER</span><strong>{providerReady ? "VERIFIED" : "NOT VERIFIED"}</strong><small>{providerReady ? "Generation test passed" : "Run a model test in settings"}</small></article>
    </div>
    <section className={"command-core " + (busy ? "is-processing" : providerReady ? "is-connected" : "is-standby")} aria-label={"NEXUS AI Core status: " + status.toLowerCase()}>
      <div className="command-core-copy"><span>NEURAL INTERFACE</span><h3>NEXUS <em>AI CORE</em></h3><p>{busy ? "Processing an active request" : providerReady ? "Generation test verified for this session" : "Awaiting a verified model connection"}</p></div>
      <div className="command-core-visual" aria-hidden="true"><i className="command-core-orbit orbit-one"/><i className="command-core-orbit orbit-two"/><i className="command-core-orbit orbit-three"/><div className="command-core-sphere"><span>N</span><small>CORE</small></div><b className="core-node node-one"/><b className="core-node node-two"/><b className="core-node node-three"/></div>
      <div className="command-core-meta"><span><i/> ROUTE <b>{route.toUpperCase()}</b></span><span><i/> MODEL <b>{model || "NOT SELECTED"}</b></span><span><i/> STATE <b>{status}</b></span></div>
    </section>
    <div className="command-center-lower">
      <div className="command-launch">
        <div className="command-subheading"><span>QUICK LAUNCH</span><small>OPEN A WORKSPACE</small></div>
        <div className="command-launch-grid">
          <button onClick={onOpenAgents}><Bot/><span><b>Agents</b><small>Run intelligent tasks</small></span><i>↗</i></button>
          <button onClick={onOpenMemory}><MemoryStick/><span><b>Memory</b><small>Manage personal context</small></span><i>↗</i></button>
          <button onClick={onOpenKnowledge}><BookOpen/><span><b>Knowledge</b><small>Search project sources</small></span><i>↗</i></button>
          <button onClick={onOpenProjects}><FolderKanban/><span><b>Projects</b><small>Organize your work</small></span><i>↗</i></button>
          <button onClick={onOpenFiles}><FolderOpen/><span><b>File system</b><small>Manage permitted files</small></span><i>↗</i></button>
          <button onClick={onOpenTools}><Plug/><span><b>Tools & MCP</b><small>Connected capabilities</small></span><i>↗</i></button>
        </div>
      </div>
      <aside className="command-focus">
        <div className="command-subheading"><span>COMMAND BRIEFING</span><Sparkles size={15}/></div>
        <div className="command-focus-orb"><Command size={24}/></div>
        <h3>Prepare your next move.</h3>
        <p>Draft a task-planning prompt or configure the intelligence layer.</p>
        <button className="command-primary" onClick={onStartPlanning}><Zap size={14}/> Draft a plan</button>
        <button className="command-secondary" onClick={onOpenSettings}><Settings2 size={14}/> Model settings</button>
      </aside>
    </div>
    <section className="command-monitor" aria-label="System monitor">
      <div className="command-subheading"><span>SYSTEM MONITOR</span><small>LIVE APPLICATION STATE</small></div>
      <div className="command-monitor-grid">
        <article data-health={workspaceReady ? "good" : "pending"}><span className="command-health-dot"/><div><strong>Workspace storage</strong><small>{workspaceReady ? "Conversation data loaded" : "Loading workspace data"}</small></div><b>{workspaceReady ? "READY" : "LOADING"}</b></article>
        <article data-health={providerConnection === "reachable" ? "good" : providerConnection === "failed" ? "bad" : "pending"}><span className="command-health-dot"/><div><strong>Provider endpoint</strong><small>{providerConnection === "reachable" ? "Endpoint responded" : providerConnection === "failed" ? "Last endpoint check failed" : providerConnection === "checking" ? "Checking endpoint" : "Not checked this session"}</small></div><b>{providerConnection.toUpperCase()}</b></article>
        <article data-health={credentialVault === "available" || credentialVault === "browser" ? "good" : credentialVault === "unavailable" ? "bad" : "pending"}><span className="command-health-dot"/><div><strong>Credential vault</strong><small>{credentialVault === "available" ? "OS vault available" : credentialVault === "browser" ? "Native vault unavailable in browser preview" : credentialVault === "missing" ? "No provider key saved" : credentialVault === "unavailable" ? "OS vault unavailable" : "Checking vault"}</small></div><b>{credentialVault.toUpperCase()}</b></article>
        <article data-health={providerReady ? "good" : "pending"}><span className="command-health-dot"/><div><strong>Model generation</strong><small>{providerReady ? "Generation test passed" : "Generation not verified"}</small></div><b>{providerReady ? "VERIFIED" : "UNTESTED"}</b></article>
      </div>
    </section>
    <section className="command-activity" aria-label="Recent workspace activity">
      <div className="command-subheading"><span>RECENT WORKSPACE ACTIVITY</span><small>FROM SAVED CONVERSATIONS</small></div>
      {recentActivity.length ? <ol>{recentActivity.map(item => <li key={item.id}><span className="command-activity-dot"/><div><strong>{item.title}</strong><small>{item.messageCount} messages · {new Date(item.updatedAt).toLocaleString()}</small></div></li>)}</ol> : <p>No conversation activity yet. Start a chat and it will appear here.</p>}
    </section>
  </section>;
}
