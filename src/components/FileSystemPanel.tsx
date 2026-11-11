import { useEffect, useMemo, useState } from "react";
import { ChevronDown, File, FileCode2, FileImage, FileText, Folder, HardDrive, LockKeyhole, RefreshCw, Search, ShieldCheck, X } from "lucide-react";

type WorkspaceFile = { id: string; name: string; folder: string; kind: "code" | "text" | "image"; size: string; modified: string; description: string; preview: string };
const files: WorkspaceFile[] = [
  { id: "readme", name: "README.md", folder: "NEXUS AU", kind: "text", size: "4.2 KB", modified: "Today", description: "Project overview and getting started", preview: "# NEXUS AU\n\nA personal AI workspace built around a modular core.\n\nCurrent focus: interface, model routing, memory, agents and secure workspace tools." },
  { id: "architecture", name: "ARCHITECTURE.md", folder: "NEXUS AU / docs", kind: "text", size: "12.8 KB", modified: "Today", description: "System architecture and module boundaries", preview: "# Architecture\n\nNEXUS AU separates the interface, AI core, memory, tools and desktop integration.\n\nThe UI preview uses sample data. Native file access is not connected yet." },
  { id: "app", name: "App.tsx", folder: "NEXUS AU / src", kind: "code", size: "31.3 KB", modified: "Today", description: "Main application workspace", preview: "import { useEffect, useMemo, useState } from \"react\";\n\nexport default function App() {\n  // NEXUS AU application shell\n  return <div className=\"app-shell\">...</div>;\n}" },
  { id: "theme", name: "styles.css", folder: "NEXUS AU / src", kind: "code", size: "36.1 KB", modified: "Today", description: "Workspace design system and responsive styles", preview: ":root {\n  --nx-bg: #070b12;\n  --nx-panel: #0b121d;\n  --nx-cyan: #79c7e8;\n}\n\n/* JARVIS-inspired interface */" },
  { id: "roadmap", name: "ROADMAP.md", folder: "NEXUS AU / docs", kind: "text", size: "8.6 KB", modified: "Yesterday", description: "Development phases and milestones", preview: "# Roadmap\n\n1. Complete the interface\n2. Connect the AI core\n3. Memory and knowledge\n4. Agents and tools\n5. Native workspace access\n6. Security and release" },
  { id: "logo", name: "nexus-mark.svg", folder: "NEXUS AU / assets", kind: "image", size: "18 KB", modified: "Oct 29", description: "NEXUS identity mark", preview: "SVG asset preview is not available in this interface concept." }
];
const folders = ["NEXUS AU", "NEXUS AU / src", "NEXUS AU / docs", "NEXUS AU / assets"];
const iconFor = (kind: WorkspaceFile["kind"]) => kind === "code" ? FileCode2 : kind === "image" ? FileImage : FileText;

export function FileSystemPanel({ onClose }: { onClose: () => void }) {
  const [folder, setFolder] = useState("NEXUS AU");
  const [selected, setSelected] = useState("readme");
  const [query, setQuery] = useState("");
  const [treeOpen, setTreeOpen] = useState(true);
  const [notice, setNotice] = useState("");
  useEffect(() => { const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", handleKeyDown); return () => window.removeEventListener("keydown", handleKeyDown); }, [onClose]);
  const visible = useMemo(() => files.filter(file => (folder === "NEXUS AU" || file.folder === folder || file.folder.startsWith(folder + " /")) && file.name.toLowerCase().includes(query.toLowerCase())), [folder, query]);
  const current = files.find(file => file.id === selected && visible.some(item => item.id === file.id)) ?? visible[0] ?? null;
  const Icon = current ? iconFor(current.kind) : File;
  return <div className="modal-backdrop file-workspace-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="file-workspace" role="dialog" aria-modal="true" aria-labelledby="file-workspace-title">
      <header className="file-workspace-header">
        <div className="file-workspace-heading"><div className="file-workspace-mark"><HardDrive size={19}/></div><div><div className="eyebrow">NATIVE WORKSPACE MODULE</div><h2 id="file-workspace-title">File system</h2><p>Browse and inspect your workspace files</p></div></div>
        <div className="file-workspace-header-actions"><span className="file-preview-state"><i/> DESIGN PREVIEW</span><button className="icon-btn" onClick={onClose} aria-label="Close file system"><X size={18}/></button></div>
      </header>
      <div className="file-workspace-toolbar">
        <div className="file-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search files and folders..." aria-label="Search files"/></div>
        <button className="secondary-btn" onClick={() => setNotice("The Windows folder connection is part of the native integration phase.")}><RefreshCw size={14}/> Refresh</button>
        <button className="secondary-btn" onClick={() => setNotice("File import will be enabled after native workspace permissions are connected.")}>Import</button>
      </div>
      <div className="file-workspace-body">
        <aside className="file-tree">
          <div className="file-pane-label">LOCATIONS</div>
          <button className="file-tree-root" aria-expanded={treeOpen} onClick={() => setTreeOpen(value => !value)}><ChevronDown className={treeOpen ? "" : "collapsed"} size={14}/><HardDrive size={15}/> Workspace</button>
          {treeOpen && <div className="file-tree-children">{folders.map(path => <button key={path} className={folder === path ? "active" : ""} onClick={() => { setFolder(path); setSelected(""); }}><Folder size={14}/><span>{path.split(" / ").pop()}</span></button>)}</div>}
          <div className="file-tree-security"><LockKeyhole size={15}/><span>Access is not connected. NEXUS cannot read or change Windows files in this preview.</span></div>
        </aside>
        <div className="file-list-pane">
          <div className="file-pane-heading"><div><span className="file-pane-label">CURRENT LOCATION</span><strong>{folder.replaceAll(" / ", "  /  ")}</strong></div><span>{visible.length} items</span></div>
          <div className="file-table-head"><span>NAME</span><span>SIZE</span><span>MODIFIED</span></div>
          <div className="file-list" role="list" aria-label="Workspace files">{visible.map(file => { const RowIcon = iconFor(file.kind); return <button key={file.id} className={current?.id === file.id ? "selected" : ""} onClick={() => setSelected(file.id)}><span className="file-name"><RowIcon size={16}/><span><strong>{file.name}</strong><small>{file.description}</small></span></span><span>{file.size}</span><span>{file.modified}</span></button>; })}{!visible.length && <div className="file-empty">No matching files in this location.</div>}</div>
        </div>
        <aside className="file-preview-pane">
          <div className="file-pane-label">INSPECTOR</div>
          {current ? <><div className="file-preview-icon"><Icon size={24}/></div><h3>{current.name}</h3><p>{current.description}</p><div className="file-meta"><span>TYPE<strong>{current.kind.toUpperCase()}</strong></span><span>SIZE<strong>{current.size}</strong></span><span>UPDATED<strong>{current.modified}</strong></span></div><div className="file-preview-content"><div className="file-pane-label">PREVIEW</div><pre>{current.preview}</pre></div></> : <div className="file-empty">Select a file to inspect it.</div>}
        </aside>
      </div>
      <footer className="file-workspace-footer"><span><ShieldCheck size={15}/> Permission-first access · Read/write operations are not enabled</span><button className="secondary-btn" onClick={onClose}>Close workspace</button></footer>
      {notice && <button className="file-notice" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
    </section>
  </div>;
}
