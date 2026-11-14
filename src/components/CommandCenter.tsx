import { t, useLanguage } from "../lib/i18n";
import { Activity, ArrowUpRight, BookOpen, Bot, Command, Cpu, FlaskConical, FolderKanban, FolderOpen, MemoryStick, Plug, Settings2, ShieldCheck, Sparkles, Zap } from "lucide-react";

function formatActivityTime(timestamp: number, language: "ru" | "en"): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return t("just now");
  if (elapsed < 3_600_000) return Math.floor(elapsed / 60_000) + " " + t("m ago");
  if (elapsed < 86_400_000) return Math.floor(elapsed / 3_600_000) + " " + t("h ago");
  return new Date(timestamp).toLocaleDateString(language === "ru" ? "ru-RU" : "en-US", { month: "short", day: "numeric" });
}

type CommandCenterProps = {
  projectCount: number;
  conversationCount: number;
  model: string;
  route: "remote" | "local";
  providerReady: boolean;
  providerConnection: "unchecked" | "checking" | "reachable" | "failed";
  credentialVault: "loading" | "available" | "not_required" | "missing" | "unavailable" | "browser";
  workspaceReady: boolean;
  busy: boolean;
  recentActivity: Array<{ id: string; title: string; updatedAt: number; messageCount: number }>;
  onOpenAgents: () => void;
  onOpenMemory: () => void;
  onOpenKnowledge: () => void;
  onOpenProjects: () => void;
  onOpenFiles: () => void;
  onOpenTools: () => void;
  onOpenTrainingLab: () => void;
  onOpenSettings: () => void;
  onStartPlanning: () => void;
};

export function CommandCenter(props: CommandCenterProps) {
  const { language } = useLanguage();
  const { projectCount, conversationCount, model, route, providerReady, providerConnection, credentialVault, workspaceReady, busy, recentActivity,
    onOpenAgents, onOpenMemory, onOpenKnowledge, onOpenProjects, onOpenFiles, onOpenTools, onOpenTrainingLab, onOpenSettings, onStartPlanning } = props;
  const status = busy ? "PROCESSING" : providerReady ? "READY" : "STANDBY";
  const tools = [
    { label: "Agents", detail: "Autonomous workflows", icon: Bot, action: onOpenAgents, code: "01" },
    { label: "Memory", detail: "Personal context", icon: MemoryStick, action: onOpenMemory, code: "02" },
    { label: "Knowledge", detail: "Indexed sources", icon: BookOpen, action: onOpenKnowledge, code: "03" },
    { label: "Projects", detail: "Separate workspaces", icon: FolderKanban, action: onOpenProjects, code: "04" },
    { label: "File system", detail: "Local workspace access", icon: FolderOpen, action: onOpenFiles, code: "05" },
    { label: "Tools & MCP", detail: "External capabilities", icon: Plug, action: onOpenTools, code: "06" },
    { label: "Training Lab", detail: "Evaluation experiments", icon: FlaskConical, action: onOpenTrainingLab, code: "07" }
  ];
  return <section className="command-center" aria-label={t("NEXUS command center")}>
    <div className="deck-heading">
      <div><span className="command-kicker"><Activity size={12}/> NEXUS / COMMAND DECK</span><h2>{t("System overview")}<span className="deck-heading-index">01 — 04</span></h2><p>{t("One control surface for your intelligence layer, workspace and tools.")}</p></div>
      <button className="deck-configure" onClick={onOpenSettings}><Settings2 size={15}/> {t("Configure core")} <ArrowUpRight size={13}/></button>
    </div>
    <section className={"deck-core " + (busy ? "is-processing" : providerReady ? "is-connected" : "is-standby")} aria-label={"NEXUS AI Core status: " + status.toLowerCase()}>
      <div className="deck-core-grid" aria-hidden="true"/>
      <div className="deck-core-copy"><span className="deck-overline">{t("CENTRAL INTELLIGENCE SYSTEM")}</span><h3>NEXUS <em>AI CORE</em></h3><p>{busy ? t("Processing an active request") : providerReady ? t("Generation test verified for this session") : t("Awaiting a verified model connection")}</p><div className="deck-core-tags"><span><i/> {t(route === "remote" ? "REMOTE" : "LOCAL*")} {t("ROUTE")}</span><span><i/> {t(status)}</span></div></div>
      <div className="deck-reactor" aria-hidden="true"><i className="reactor-ring ring-a"/><i className="reactor-ring ring-b"/><i className="reactor-ring ring-c"/><i className="reactor-ring ring-d"/><div className="reactor-halo"/><div className="reactor-center"><span>N</span><small>CORE</small></div><b className="reactor-node node-a"/><b className="reactor-node node-b"/><b className="reactor-node node-c"/></div>
      <div className="deck-core-readout"><div><span>{t("MODEL")}</span><strong>{model || t("NOT SELECTED")}</strong></div><div><span>{t("PROJECTS")}</span><strong>{projectCount.toLocaleString()}</strong></div><div><span>{t("CONVERSATIONS")}</span><strong>{conversationCount.toLocaleString()}</strong></div><div><span>{t("PROVIDER")}</span><strong className={providerReady ? "readout-good" : "readout-muted"}>{providerReady ? t("VERIFIED") : t("NOT VERIFIED")}</strong></div></div>
    </section>
    <div className="deck-workspace">
      <section className="deck-tools">
        <div className="deck-section-heading"><div><span>{t("WORKSPACE MODULES")}</span><h3>{t("Launch a subsystem")}</h3></div><small>07 MODULES</small></div>
        <div className="deck-tool-grid">{tools.map(item => { const Icon = item.icon; return <button className="deck-tool" key={item.code} onClick={item.action}><span className="deck-tool-code">{item.code}</span><span className="deck-tool-icon"><Icon size={18}/></span><span className="deck-tool-copy"><strong>{t(item.label)}</strong><small>{t(item.detail)}</small></span><ArrowUpRight className="deck-tool-arrow" size={14}/></button>; })}</div>
      </section>
      <aside className="deck-briefing">
        <div className="deck-section-heading"><div><span>{t("MISSION CONTROL")}</span><h3>{t("Next operation")}</h3></div><Sparkles size={16}/></div>
        <div className="deck-briefing-mark"><Command size={22}/><span>{t("READY FOR INPUT")}</span></div>
        <h4>{t("Turn an idea into a plan.")}</h4><p>{t("Break a goal into steps, identify dependencies and prepare a bounded workflow.")}</p>
        <button className="deck-plan-button" onClick={onStartPlanning}><Zap size={14}/> {t("Draft a plan")} <ArrowUpRight size={13}/></button>
        <button className="deck-settings-link" onClick={onOpenSettings} aria-label={t("Open model settings")}><Cpu size={14}/> {t("Open model configuration")}</button>
      </aside>
    </div>
    <div className="deck-bottom">
      <section className="command-monitor" aria-label={t("System monitor")}>
        <div className="deck-section-heading"><div><span>{t("SYSTEM MONITOR")}</span><h3>{t("Live status")}</h3></div><small>{t("SESSION HEALTH")}</small></div>
        <div className="command-monitor-grid">
          <article data-health={workspaceReady ? "good" : "pending"}><span className="command-health-dot"/><div><strong>{t("Workspace storage")}</strong><small>{workspaceReady ? t("Conversation data loaded") : t("Loading workspace data")}</small></div><b>{workspaceReady ? t("READY") : t("LOADING")}</b></article>
          <article data-health={providerConnection === "reachable" ? "good" : providerConnection === "failed" ? "bad" : "pending"}><span className="command-health-dot"/><div><strong>{t("Provider endpoint")}</strong><small>{providerConnection === "reachable" ? t("Endpoint responded") : providerConnection === "failed" ? t("Last endpoint check failed") : providerConnection === "checking" ? t("Checking endpoint") : t("Not checked this session")}</small></div><b>{providerConnection.toUpperCase()}</b></article>
          <article data-health={credentialVault === "available" || credentialVault === "not_required" ? "good" : credentialVault === "unavailable" ? "bad" : "pending"}><span className="command-health-dot"/><div><strong>{t("Credential vault")}</strong><small>{credentialVault === "available" ? t("OS vault available") : credentialVault === "not_required" ? t("No key required for loopback profile") : credentialVault === "browser" ? t("Native vault unavailable in browser preview") : credentialVault === "missing" ? t("No provider key saved") : credentialVault === "unavailable" ? t("OS vault unavailable") : t("Checking vault")}</small></div><b>{credentialVault === "not_required" ? t("NOT REQUIRED") : t(credentialVault.toUpperCase())}</b></article>
          <article data-health={providerReady ? "good" : "pending"}><span className="command-health-dot"/><div><strong>{t("Model generation")}</strong><small>{providerReady ? t("Generation test passed") : t("Generation not verified")}</small></div><b>{providerReady ? t("VERIFIED") : t("UNTESTED")}</b></article>
        </div>
      </section>
      <section className="command-activity" aria-label={t("Recent workspace activity")}>
        <div className="deck-section-heading"><div><span>{t("WORKSPACE TIMELINE")}</span><h3>{t("Recent saved activity")}</h3></div><small>{recentActivity.length} ITEMS</small></div>
        {recentActivity.length ? <ol>{recentActivity.map(item => <li key={item.id}><span className="command-activity-dot"/><div><strong>{item.title}</strong><small>{item.messageCount} messages · {t("updated")} {formatActivityTime(item.updatedAt, language)}</small></div></li>)}</ol> : <p>{t("No activity recorded yet. Start a conversation to populate the timeline.")}</p>}
      </section>
    </div>
    <div className="deck-footer"><span><ShieldCheck size={13}/> {t("PRIVATE WORKSPACE")}</span><span>{t("ROUTE")}: {t(route === "remote" ? "REMOTE" : "LOCAL*")}</span><span>{t("CORE STATE")}: {t(status)}</span></div>
  </section>;
}
