import { useState } from "react";
import { Activity, ArrowUpRight, Bot, ChevronDown, CircleDot, Cloud, Code2, Database, Globe2, LockKeyhole, Plug, Search, ShieldCheck, Terminal, X } from "lucide-react";

type ToolItem = { id: string; name: string; group: string; description: string; icon: typeof Plug; mode: string; permission: string };
const catalog: ToolItem[] = [
  { id: "browser", name: "Browser", group: "WEB", description: "Open approved pages and retrieve public information.", icon: Globe2, mode: "Read-only", permission: "Network access" },
  { id: "github", name: "GitHub", group: "DEVELOPMENT", description: "Inspect repositories, commits, issues and pull requests.", icon: Code2, mode: "Read / write by approval", permission: "Repository scope" },
  { id: "filesystem", name: "Workspace files", group: "DESKTOP", description: "Read and edit files inside folders explicitly approved by the owner.", icon: Database, mode: "Permission-gated", permission: "Folder access" },
  { id: "terminal", name: "Command runner", group: "DESKTOP", description: "Run narrowly scoped development commands with explicit approval.", icon: Terminal, mode: "Approval required", permission: "Command allowlist" },
  { id: "agents", name: "Agent runtime", group: "NEXUS CORE", description: "Execute bounded agent tasks and record their activity.", icon: Bot, mode: "Bounded execution", permission: "Tool gateway" },
  { id: "cloud", name: "OmniRoute", group: "AI PROVIDERS", description: "Route model requests through the configured OpenAI-compatible gateway.", icon: Cloud, mode: "Provider-dependent", permission: "Credential vault" }
];

export function ToolsPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState("browser");
  const [notice, setNotice] = useState("");
  const filtered = catalog.filter(item => (item.name + " " + item.description + " " + item.group).toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-backdrop tools-workspace-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="tools-workspace" role="dialog" aria-modal="true" aria-labelledby="tools-workspace-title">
      <header className="tools-workspace-header"><div className="file-workspace-heading"><div className="file-workspace-mark"><Plug size={19}/></div><div><div className="eyebrow">EXTENSIONS & PERMISSIONS</div><h2 id="tools-workspace-title">Tools & MCP</h2><p>Connect external capabilities through controlled access</p></div></div><div className="file-workspace-header-actions"><span className="file-preview-state"><i/> CATALOG PREVIEW</span><button className="icon-btn" onClick={onClose} aria-label="Close tools"><X size={18}/></button></div></header>
      <div className="tools-summary"><div><span>AVAILABLE IN CATALOG</span><strong>{String(catalog.length).padStart(2, "0")}</strong></div><div><span>CONNECTED</span><strong>NOT CONNECTED</strong></div><div><span>SECURITY MODEL</span><strong>APPROVAL GATED</strong></div></div>
      <div className="tools-toolbar"><div className="file-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tools and integrations..." aria-label="Search tools"/></div><span><Activity size={14}/> Connection status requires native runtime</span></div>
      <div className="tools-catalog">{filtered.map(item => { const Icon = item.icon; const open = expanded === item.id; return <article className={open ? "tool-card expanded" : "tool-card"} key={item.id}><button className="tool-card-main" onClick={() => setExpanded(open ? "" : item.id)} aria-expanded={open} aria-controls={`tool-details-${item.id}`}><div className="tool-icon"><Icon size={19}/></div><div className="tool-card-copy"><span>{item.group}</span><strong>{item.name}</strong><small>{item.description}</small></div><span className="tool-preview-badge"><CircleDot size={11}/> PREVIEW</span><ChevronDown className={open ? "rotated" : ""} size={16}/></button>{open && <div className="tool-card-details" id={`tool-details-${item.id}`}><div><span>EXECUTION MODE</span><strong>{item.mode}</strong></div><div><span>REQUIRED PERMISSION</span><strong>{item.permission}</strong></div><p><LockKeyhole size={14}/> This catalog entry is a design placeholder. No connector is installed or authorized by this screen.</p><button className="secondary-btn" onClick={() => setNotice(item.name + ": connection controls will appear after the tool gateway is integrated.")}>View connection requirements <ArrowUpRight size={13}/></button></div>}</article>; })}{!filtered.length && <div className="file-empty">No tools match this search.</div>}</div>
      <footer className="file-workspace-footer"><span><ShieldCheck size={15}/> Tools must be explicitly connected and permission-scoped</span><button className="secondary-btn" onClick={onClose}>Close</button></footer>
      {notice && <div className="file-notice" role="status" aria-live="polite"><span>{notice}</span><button type="button" className="file-notice-dismiss" aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
    </section>
  </div>;
}
