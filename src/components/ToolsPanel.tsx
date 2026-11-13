import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, ChevronDown, CircleDot, Cloud, Code2, Database, Globe2, LockKeyhole, Plug, Search, ShieldCheck, Terminal, X, Plus, RefreshCw, Trash2 } from "lucide-react";
import { createWorkspaceNexusRuntime } from "../lib/nexusRuntime";
import { loadMcpServerConfigs, removeMcpServerConfig, saveMcpServerConfig, type McpServerConfigRecord } from "../lib/mcpServerStorage";

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
  const runtime = useMemo(() => createWorkspaceNexusRuntime("tools-panel-user"), []);
  const [servers, setServers] = useState<McpServerConfigRecord[]>([]);
  const [serverName, setServerName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [serverId, setServerId] = useState("");
  const [connectionStates, setConnectionStates] = useState<Record<string, { status: string; tools: number; toolNames: string[]; detail: string }>>({});
  const [mcpBusy, setMcpBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState("browser");
  const [notice, setNotice] = useState("");
  const filtered = catalog.filter(item => (item.name + " " + item.description + " " + item.group).toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const loaded = loadMcpServerConfigs(window.localStorage);
    if (!loaded.ok) { setNotice(loaded.error.message); return; }
    setServers(loaded.value);
    const controller = new AbortController();
    void (async () => {
      for (const server of loaded.value) {
        if (controller.signal.aborted) break;
        await connectSavedServer(server, controller.signal);
      }
    })();
    return () => {
      controller.abort();
      void Promise.all(runtime.mcpClient.listServers().map(server => runtime.mcpClient.disconnect(server.id)));
    };
  }, []);

  async function connectSavedServer(server: McpServerConfigRecord, signal: AbortSignal) {
    await runtime.mcpClient.disconnect(server.id);
    setConnectionStates(current => ({ ...current, [server.id]: { status: "connecting", tools: 0, toolNames: [], detail: "Initializing MCP session…" } }));
    const connected = await runtime.connectMcpHttp({ ...server, version: "1" }, signal);
    if (!connected.ok) {
      setConnectionStates(current => ({ ...current, [server.id]: { status: "failed", tools: 0, toolNames: [], detail: connected.error.message } }));
      return;
    }
    if (signal.aborted) { await runtime.mcpClient.disconnect(server.id); return; }
    const listed = await runtime.mcpClient.listTools(server.id, signal);
    if (!listed.ok) {
      setConnectionStates(current => ({ ...current, [server.id]: { status: "connected", tools: 0, toolNames: [], detail: listed.error.message } }));
      return;
    }
    setConnectionStates(current => ({ ...current, [server.id]: { status: "connected", tools: listed.value.length, toolNames: listed.value.map(tool => tool.name), detail: "MCP session initialized. Every agent call requires per-call approval." } }));
  }

  async function addServer() {
    if (mcpBusy) return;
    const id = serverId.trim() || serverName.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
    const config = { id, name: serverName.trim(), endpoint: endpoint.trim() };
    const saved = saveMcpServerConfig(window.localStorage, config);
    if (!saved.ok) { setNotice(saved.error.message); return; }
    setServers(saved.value);
    setMcpBusy(true);
    try {
      await connectSavedServer(config, new AbortController().signal);
      setServerName(""); setEndpoint(""); setServerId("");
    } finally { setMcpBusy(false); }
  }

  async function reconnectServer(server: McpServerConfigRecord) {
    if (mcpBusy) return;
    setMcpBusy(true);
    try { await connectSavedServer(server, new AbortController().signal); }
    finally { setMcpBusy(false); }
  }

  async function removeServer(server: McpServerConfigRecord) {
    if (mcpBusy || connectionStates[server.id]?.status === "connecting") return;
    setMcpBusy(true);
    try {
      await runtime.mcpClient.disconnect(server.id);
      const removed = removeMcpServerConfig(window.localStorage, server.id);
      if (!removed.ok) { setNotice(removed.error.message); return; }
      setServers(removed.value);
      setConnectionStates(current => { const next = { ...current }; delete next[server.id]; return next; });
    } finally { setMcpBusy(false); }
  }
  return <div className="modal-backdrop tools-workspace-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="tools-workspace" role="dialog" aria-modal="true" aria-labelledby="tools-workspace-title">
      <header className="tools-workspace-header"><div className="file-workspace-heading"><div className="file-workspace-mark"><Plug size={19}/></div><div><div className="eyebrow">EXTENSIONS & PERMISSIONS</div><h2 id="tools-workspace-title">Tools & MCP</h2><p>Connect external capabilities through controlled access</p></div></div><div className="file-workspace-header-actions"><span className="file-preview-state"><i/> LIVE MCP + CATALOG</span><button className="icon-btn" onClick={onClose} aria-label="Close tools"><X size={18}/></button></div></header>
      <section className="mcp-manager" aria-label="MCP server connections">
        <div className="mcp-manager-heading"><div><span>LIVE INTEGRATIONS</span><strong>MCP servers</strong><small>Connect remote tool servers over HTTPS or loopback HTTP.</small></div><span>{servers.length} SAVED</span></div>
        <div className="mcp-add-grid">
          <label>Server name<input aria-label="MCP server name" value={serverName} onChange={event => setServerName(event.target.value)} placeholder="My MCP server"/></label>
          <label>Endpoint URL<input aria-label="MCP endpoint URL" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="https://example.com/mcp"/></label>
          <label>Server ID (optional)<input aria-label="MCP server ID" value={serverId} onChange={event => setServerId(event.target.value)} placeholder="my-server"/></label>
          <button className="primary-btn" disabled={mcpBusy || !serverName.trim() || !endpoint.trim()} onClick={() => void addServer()}><Plus size={14}/> Save & connect</button>
        </div>
        <p className="mcp-security-note"><LockKeyhole size={13}/> This build supports unauthenticated MCP endpoints only. Use HTTPS or loopback HTTP; OAuth and bearer-token setup are not implemented. Every imported tool call requires separate approval in Agents.</p>
        {servers.length === 0 ? <div className="mcp-empty">No MCP servers configured yet.</div> : <div className="mcp-server-list">{servers.map(server => {
          const state = connectionStates[server.id] ?? { status: "saved", tools: 0, toolNames: [], detail: "Saved endpoint. Connection has not been checked yet." };
          return <article className="mcp-server-row" key={server.id}>
            <div><strong>{server.name}</strong><small>{server.endpoint}</small><span className={"mcp-state " + state.status}>{state.status.toUpperCase()} · {state.tools} TOOLS</span><small>{state.detail}</small><small>TOOLS: {state.toolNames.join(", ") || "none discovered"}</small></div>
            <div><button className="icon-btn" title="Reconnect MCP server" aria-label={"Reconnect " + server.name} disabled={mcpBusy || state.status === "connecting"} onClick={() => void reconnectServer(server)}><RefreshCw size={14}/></button><button className="icon-btn" title="Remove MCP server" aria-label={"Remove " + server.name} disabled={mcpBusy || state.status === "connecting"} onClick={() => void removeServer(server)}><Trash2 size={14}/></button></div>
          </article>;
        })}</div>}
      </section>
      <div className="tools-summary"><div><span>AVAILABLE IN CATALOG</span><strong>{String(catalog.length).padStart(2, "0")}</strong></div><div><span>CONNECTED</span><strong>{String(Object.values(connectionStates).filter(state => state.status === "connected").length).padStart(2, "0")} / {String(servers.length).padStart(2, "0")}</strong></div><div><span>SECURITY MODEL</span><strong>APPROVAL GATED</strong></div></div>
      <div className="tools-toolbar"><div className="file-search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search tools and integrations..." aria-label="Search tools"/></div><span><Activity size={14}/> {Object.values(connectionStates).some(state => state.status === "connecting") ? "Connecting to MCP servers" : "MCP connection status"}</span></div>
      <div className="tools-catalog">{filtered.map(item => { const Icon = item.icon; const open = expanded === item.id; return <article className={open ? "tool-card expanded" : "tool-card"} key={item.id}><button className="tool-card-main" onClick={() => setExpanded(open ? "" : item.id)} aria-expanded={open} aria-controls={`tool-details-${item.id}`}><div className="tool-icon"><Icon size={19}/></div><div className="tool-card-copy"><span>{item.group}</span><strong>{item.name}</strong><small>{item.description}</small></div><span className="tool-preview-badge"><CircleDot size={11}/> REFERENCE</span><ChevronDown className={open ? "rotated" : ""} size={16}/></button>{open && <div className="tool-card-details" id={`tool-details-${item.id}`}><div><span>EXECUTION MODE</span><strong>{item.mode}</strong></div><div><span>REQUIRED PERMISSION</span><strong>{item.permission}</strong></div><p><LockKeyhole size={14}/> Reference capability only. This entry is not installed or executable in the current build. Connect a real MCP server above to discover and authorize external tools.</p></div>}</article>; })}{!filtered.length && <div className="file-empty">No tools match this search.</div>}</div>
      <footer className="file-workspace-footer"><span><ShieldCheck size={15}/> Tools must be explicitly connected and permission-scoped</span><button className="secondary-btn" onClick={onClose}>Close</button></footer>
      {notice && <div className="file-notice" role="status" aria-live="polite"><span>{notice}</span><button type="button" className="file-notice-dismiss" aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
    </section>
  </div>;
}
