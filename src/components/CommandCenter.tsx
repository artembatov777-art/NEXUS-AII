import { Activity, BookOpen, Bot, Command, FolderKanban, FolderOpen, MemoryStick, Plug, Settings2, Sparkles, Zap } from "lucide-react";

type CommandCenterProps = {
  projectCount: number;
  conversationCount: number;
  model: string;
  route: "remote" | "local";
  providerReady: boolean;
  busy: boolean;
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
  projectCount, conversationCount, model, route, providerReady, busy,
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
  </section>;
}
