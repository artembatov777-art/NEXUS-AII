import { useMemo, useState } from "react";
import { Activity, BookOpen, Bot, Command, Cpu, Focus, FolderKanban, FolderOpen, MemoryStick, Plug, Search, Settings2, Sparkles, X } from "lucide-react";

export type NexusCommandId = "chat" | "agents" | "memory" | "knowledge" | "projects" | "files" | "tools" | "models" | "focus";

const commands: Array<{ id: NexusCommandId; title: string; description: string; keywords: string; icon: typeof Command }> = [
  { id: "chat", title: "Open chat", description: "Return to the main conversation", keywords: "conversation workspace assistant", icon: Sparkles },
  { id: "agents", title: "Agent center", description: "Manage agents and task runs", keywords: "automation tasks", icon: Bot },
  { id: "memory", title: "Memory", description: "Review saved personal context", keywords: "saved context", icon: MemoryStick },
  { id: "knowledge", title: "Knowledge base", description: "Search project documents", keywords: "documents sources", icon: BookOpen },
  { id: "projects", title: "Projects", description: "Organize workspaces", keywords: "workspace", icon: FolderKanban },
  { id: "files", title: "File system", description: "Open permitted files and folders", keywords: "windows files folders", icon: FolderOpen },
  { id: "tools", title: "Tools & MCP", description: "Review connected capabilities", keywords: "integrations plugins", icon: Plug },
  { id: "models", title: "Models & providers", description: "Configure OmniRoute and Ollama", keywords: "AI inference provider", icon: Cpu },
  { id: "focus", title: "Toggle Focus Mode", description: "Hide navigation for distraction-free work", keywords: "minimal fullscreen", icon: Focus }
];

export function CommandPalette({ onClose, onRun }: { onClose: () => void; onRun: (id: NexusCommandId) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return commands.filter(item => !term || (item.title + " " + item.description + " " + item.keywords).toLocaleLowerCase().includes(term));
  }, [query]);

  return <div className="modal-backdrop command-palette-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
      <header><div className="command-palette-title"><Command size={17}/><h2 id="command-palette-title">Command palette</h2><span>⌘ / CTRL + SHIFT + P</span></div><button className="icon-btn" onClick={onClose} aria-label="Close command palette"><X size={17}/></button></header>
      <label className="command-palette-search"><Search size={16}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search commands and modules…" aria-label="Search commands"/></label>
      <div className="command-palette-list">
        {filtered.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => onRun(item.id)}><span className="command-palette-icon"><Icon size={16}/></span><span><strong>{item.title}</strong><small>{item.description}</small></span><kbd>↵</kbd></button>; })}
        {filtered.length === 0 && <p className="command-palette-empty">No matching commands.</p>}
      </div>
      <footer><span><Activity size={12}/> NEXUS QUICK CONTROL</span><span>ESC TO CLOSE</span></footer>
    </section>
  </div>;
}
