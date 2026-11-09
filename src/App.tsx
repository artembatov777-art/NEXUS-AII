import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, BookOpen, Check, ChevronDown, Command, Cpu, FolderKanban, Menu, MessageSquare, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2, X, Zap, Copy, ClipboardPaste } from "lucide-react";
import { sendMessage } from "./lib/ai";
import { MemoryPanel } from "./components/MemoryPanel";
import { GlobalSearchPanel } from "./components/GlobalSearchPanel";
import { AgentControlCenter } from "./components/AgentControlCenter";
import { ProjectPanel } from "./components/ProjectPanel";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { VoiceControls } from "./components/VoiceControls";
import { loadConversations, loadProvider, saveConversations, saveProvider } from "./lib/storage";
import { ProjectService, type ProjectId, type WorkspaceProject } from "./core/projects";
import { KnowledgeRetrievalService } from "./core/knowledge";
import { WorkspaceProjectRepository } from "./lib/projectStorage";
import { WorkspaceKnowledgeRepository, WorkspaceMemoryRepository } from "./lib/nativeRepositories";
import { MemoryService, type MemoryId } from "./core/memory";

import { LocalTransformerEmbeddingProvider } from "./lib/localEmbeddings";
import { IndexedDbKnowledgeVectorIndex } from "./lib/knowledgeVectorIndex";
import type { ChatMessage, Conversation, ProviderSettings } from "./types";

const makeId = () => crypto.randomUUID();
const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Welcome to NEXUS AU. Your workspace is ready. Configure an AI provider in settings, then start a conversation.",
  createdAt: Date.now()
};

export default function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsReady, setConversationsReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderSettings>(loadProvider);
  const [apiKey, setApiKey] = useState("");
  const [hasProviderKey, setHasProviderKey] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workspaceProjects, setWorkspaceProjects] = useState<WorkspaceProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const projectService = useMemo(() => new ProjectService(
    new WorkspaceProjectRepository(window.localStorage),
    () => crypto.randomUUID() as ProjectId,
    () => Date.now()
  ), []);
  const knowledgeRepository = useMemo(() => new WorkspaceKnowledgeRepository(window.localStorage), []);
  const embeddings = useMemo(() => new LocalTransformerEmbeddingProvider(), []);
  const vectors = useMemo(() => new IndexedDbKnowledgeVectorIndex(), []);
  const knowledgeService = useMemo(() => new KnowledgeRetrievalService(
    knowledgeRepository, embeddings, vectors
  ), [knowledgeRepository, embeddings, vectors]);
  const memoryService = useMemo(() => new MemoryService(
    new WorkspaceMemoryRepository(window.localStorage),
    { memoryId: () => crypto.randomUUID() as MemoryId },
    { now: () => Date.now() }
  ), []);
  async function refreshProjects() {
    const result = await projectService.list();
    if (result.ok) {
      setWorkspaceProjects(result.value);
      setSelectedProjectId(current => result.value.some(project => project.id === current)
        ? current : result.value[0]?.id ?? "");
    }
  }
  useEffect(() => { void refreshProjects(); }, [projectService]);

  useEffect(() => {
    let mounted = true;
    void loadConversations().then(items => { if (mounted) { setConversations(items); setConversationsReady(true); } }).catch(e => { if (mounted) { setError(e instanceof Error ? e.message : "Could not load conversations."); setConversationsReady(true); } });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { if (conversationsReady) void saveConversations(conversations).catch(e => setError(e instanceof Error ? e.message : "Could not save conversations.")); }, [conversations, conversationsReady]);
  useEffect(() => { saveProvider(provider); }, [provider]);
  useEffect(() => { void invoke<boolean>("has_provider_key").then(setHasProviderKey).catch(() => setHasProviderKey(false)); }, []);
  useEffect(() => { invoke<string>("get_app_version").then(setAppVersion).catch(() => undefined); }, []);

  const active = useMemo(() => conversations.find(c => c.id === activeId) ?? null, [conversations, activeId]);
  const messages = active?.messages ?? [welcome];

  function newChat() {
    if (!conversationsReady) return;
    const item: Conversation = { id: makeId(), title: "New conversation", messages: [welcome], updatedAt: Date.now(), ...(selectedProjectId ? { projectId: selectedProjectId } : {}) };
    setConversations(current => [item, ...current]);
    setActiveId(item.id);
    setError("");
  }
  function updateMessages(id: string, next: ChatMessage[]) {
    setConversations(current => current.map(c => c.id === id
      ? { ...c, messages: next, title: c.title === "New conversation" ? (next.find(m => m.role === "user")?.content.slice(0, 36) || c.title) : c.title, updatedAt: Date.now() }
      : c));
  }
  async function submit() {
    const text = draft.trim();
    if (!text || busy || !conversationsReady) return;
    let target = active;
    if (!target) {
      target = { id: makeId(), title: text.slice(0, 36), messages: [welcome], updatedAt: Date.now(), ...(selectedProjectId ? { projectId: selectedProjectId } : {}) };
      setConversations(current => [target!, ...current]);
      setActiveId(target.id);
    }
    const userMessage: ChatMessage = { id: makeId(), role: "user", content: text, createdAt: Date.now() };
    const next = [...target.messages.filter(m => m.id !== "welcome"), userMessage];
    updateMessages(target.id, next);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const contextParts: string[] = [];
      const remembered = await memoryService.search(text, "profile", 5);
      if (!remembered.ok) throw new Error(`Could not retrieve saved memory: ${remembered.error.message}`);
      if (remembered.value.length) contextParts.push("Relevant user-approved memories:\n" + remembered.value.map(item => `[Memory: ${item.category}; source: ${item.source.label}]\n${item.content}`).join("\n\n"));
      let sourceReferences: import("./types").ChatSourceReference[] = [];
      if (selectedProjectId) {
        const [retrieved, projectMemories] = await Promise.all([
          knowledgeService.retrieve(text, selectedProjectId, 6),
          memoryService.search(text, "project", 5, selectedProjectId)
        ]);
        if (!retrieved.ok) throw new Error(`Could not retrieve project knowledge: ${retrieved.error.message}`);
        if (!projectMemories.ok) throw new Error(`Could not retrieve project memories: ${projectMemories.error.message}`);
        if (retrieved.value.context) contextParts.push("Selected project knowledge:\n" + retrieved.value.context);
        sourceReferences = retrieved.value.citations;
        if (projectMemories.value.length) contextParts.push("Selected project memories:\n" + projectMemories.value.map(item => `[Project memory: ${item.category}]\n${item.content}`).join("\n\n"));
      }
      const answer = await sendMessage(provider, next, contextParts.join("\n\n"));
      updateMessages(target.id, [...next, { id: makeId(), role: "assistant", content: answer, createdAt: Date.now(), ...(sourceReferences.length ? { sourceReferences } : {}) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function removeConversation(id: string) {
    setConversations(current => current.filter(c => c.id !== id));
    if (activeId === id) setActiveId(null);
  }


  async function saveProviderSettings() {
    try {
      if (apiKey.trim()) { await invoke("store_provider_key", { apiKey }); setApiKey(""); setHasProviderKey(true); }
      saveProvider(provider);
      setSettingsOpen(false);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save provider credentials."); }
  }
  async function deleteProviderKey() {
    try { await invoke("delete_provider_key"); setHasProviderKey(false); setApiKey(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove provider credentials."); }
  }


  async function copyText(text: string) {
    try { await invoke("write_clipboard", { text }); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not copy text."); }
  }
  async function pasteText() {
    try { const text = await invoke<string>("read_clipboard"); setDraft(current => current ? current + text : text); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read clipboard."); }
  }

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "" : "sidebar-hidden"}`}>
      <div className="brand"><div className="brand-mark"><Sparkles size={18}/></div><div><strong>NEXUS</strong><span>AU WORKSPACE</span></div><button className="icon-btn mobile-only" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={17}/></button></div>
      <button className="new-chat" onClick={newChat} disabled={!conversationsReady}><Plus size={17}/> New conversation <span>⌘ K</span></button>
      <div className="nav-label">WORKSPACE</div>
      <button className="nav-item selected"><MessageSquare size={17}/> Chat <span className="nav-count">{conversations.length}</span></button>
      <button className="nav-item" onClick={() => setMemoryOpen(true)}><Sparkles size={17}/> Memory</button>
      <button className="nav-item" onClick={() => setProjectsOpen(true)}><FolderKanban size={17}/> Projects</button>
      <button className="nav-item" onClick={() => setKnowledgeOpen(true)}><BookOpen size={17}/> Knowledge base</button>
      <button className="nav-item" onClick={() => setAgentsOpen(true)}><Bot size={17}/> Agents</button>
      <button className="nav-item" onClick={() => setSettingsOpen(true)}><Cpu size={17}/> Models & providers</button>
      <div className="history-heading"><span>RECENT</span><div><button className="icon-btn" onClick={() => setGlobalSearchOpen(true)} title="Search all workspace data" aria-label="Search all workspace data"><Search size={14}/></button><button className="icon-btn" onClick={() => setConversations([])} title="Clear all history"><Trash2 size={14}/></button></div></div>
      <div className="history-search"><Search size={13}/><input value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="Search history…"/></div>
      <div className="history-list">
        {conversations.filter(c => (c.projectId ?? "") === selectedProjectId && (c.title+" "+c.messages.map(m=>m.content).join(" ")).toLocaleLowerCase().includes(historyQuery.toLocaleLowerCase())).map(c => <div className={`history-row ${activeId === c.id ? "active" : ""}`} key={c.id}><button onClick={() => { setActiveId(c.id); setSelectedProjectId(c.projectId ?? ""); setError(""); }}><MessageSquare size={14}/><span>{c.title}</span></button><button className="delete-chat" onClick={() => removeConversation(c.id)} aria-label="Delete conversation"><X size={13}/></button></div>)}
        {conversations.filter(c => (c.projectId ?? "") === selectedProjectId).length === 0 && <p className="empty-history">No conversations in this workspace yet.</p>}
      </div>
      <div className="sidebar-bottom"><div className="secure-line"><ShieldCheck size={15}/> Local conversation storage</div><button className="profile-row" onClick={() => setSettingsOpen(true)}><div className="avatar">N</div><div><strong>NEXUS AU</strong><span>Version {appVersion}</span></div><Settings2 size={16}/></button></div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><div className="top-left"><button className="icon-btn" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar"><Menu size={18}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>Chat</strong></div></div><div className="top-right"><div className="model-pill"><span className="status-dot"/>{provider.model}<ChevronDown size={14}/></div><button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings2 size={18}/></button></div></header>
      <section className="chat-area">
        <div className="chat-heading"><div className="eyebrow"><span/> PERSONAL AI ENVIRONMENT</div><h1>{active?.title ?? "What are we building today?"}</h1><p>Your models, tools and ideas. Connected in one workspace.</p>
          <label className="chat-project-context">Project context
            <select value={selectedProjectId} onChange={e => { setSelectedProjectId(e.target.value); setActiveId(null); setError(""); }}>
              <option value="">No project context</option>
              {workspaceProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          {active && <button className="workspace-move" onClick={() => { setConversations(current => current.map(item => item.id === active.id ? (selectedProjectId ? { ...item, projectId: selectedProjectId, updatedAt: Date.now() } : { id: item.id, title: item.title, messages: item.messages, updatedAt: Date.now() }) : item)); setActiveId(null); }}>Move conversation here</button>}
        </div>
        <div className="messages">
          {messages.map(m => <div className={`message ${m.role}`} key={m.id}><div className="message-avatar">{m.role === "assistant" ? <Sparkles size={16}/> : "Y"}</div><div className="message-body"><div className="message-author">{m.role === "assistant" ? "NEXUS" : "YOU"} <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>{m.role === "assistant" && <button className="icon-btn" onClick={() => void copyText(m.content)} aria-label="Copy response"><Copy size={13}/></button>}</div><div className="message-content">{m.content}</div>{m.sourceReferences?.length ? <div className="message-sources"><strong>Sources</strong>{m.sourceReferences.map(source => <span key={source.chunkId}>{source.sourceLabel}{source.page ? ` · p. ${source.page}` : ""}{source.section ? ` · ${source.section}` : ""}</span>)}</div> : null}</div></div>)}
          {busy && <div className="message assistant"><div className="message-avatar"><Sparkles size={16}/></div><div className="message-body"><div className="message-author">NEXUS</div><div className="typing"><i/><i/><i/> Connecting to provider…</div></div></div>}
          {error && <div className="error-banner">{error}</div>}
        </div>
        {!active && <div className="suggestions"><button onClick={() => setDraft("Help me plan the next development milestone for NEXUS AU.")}><Zap size={15}/> Plan a project <span>↗</span></button><button onClick={() => setDraft("Explain a complex technical concept in simple terms.")}><Command size={15}/> Learn something <span>↗</span></button><button onClick={() => setDraft("Review this idea and identify its biggest risks.")}><Bot size={15}/> Analyze an idea <span>↗</span></button></div>}
        <div className="composer-wrap"><VoiceControls onTranscript={text => setDraft(current => current ? current+" "+text : text)} textToSpeak={[...messages].reverse().find(m => m.role === "assistant")?.content ?? ""}/><div className="composer"><div className="composer-tools"><button className="icon-btn" onClick={() => void pasteText()} aria-label="Paste from system clipboard" title="Paste from clipboard"><ClipboardPaste size={15}/></button></div><textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Message NEXUS… (Enter to send, Shift + Enter for newline)" rows={2}/><div className="composer-bottom"><span><ShieldCheck size={13}/> API key is session-only and is not saved</span><button className="send-btn" disabled={!draft.trim() || busy || !conversationsReady} onClick={() => void submit()}>{busy ? "Working…" : "Send"} <Send size={15}/></button></div></div><div className="composer-note">NEXUS AU can make mistakes. Verify important information.</div></div>
      </section>
    </main>

    {globalSearchOpen && <GlobalSearchPanel conversations={conversations} projects={workspaceProjects} onClose={() => setGlobalSearchOpen(false)} onOpenConversation={conversation => { setSelectedProjectId(conversation.projectId ?? ""); setActiveId(conversation.id); setGlobalSearchOpen(false); setError(""); }} onOpenMemory={() => { setGlobalSearchOpen(false); setMemoryOpen(true); }} onOpenKnowledge={() => { setGlobalSearchOpen(false); setKnowledgeOpen(true); }} />}
    {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
    {projectsOpen && <ProjectPanel onClose={() => { setProjectsOpen(false); void refreshProjects(); }} />}
    {knowledgeOpen && <KnowledgePanel onClose={() => setKnowledgeOpen(false)} />}
    {agentsOpen && <AgentControlCenter onClose={() => setAgentsOpen(false)} />}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><section className="settings-modal"><div className="modal-header"><div><div className="eyebrow">CONFIGURATION</div><h2>Provider settings</h2></div><button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18}/></button></div><p className="modal-description">Connect an OpenAI-compatible API endpoint. API keys are stored in the operating system credential vault, not in the application database.</p><label>Base URL<input value={provider.baseUrl} onChange={e => setProvider(p => ({ ...p, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1"/></label><label>Model<input value={provider.model} onChange={e => setProvider(p => ({ ...p, model: e.target.value }))} placeholder="gpt-4o-mini"/></label><label>API key<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={hasProviderKey ? "Saved in OS credential vault" : "Enter API key"} autoComplete="off"/><small>{hasProviderKey ? "A provider key is saved securely on this device." : "No provider key is saved."}</small></label><div className="security-note"><ShieldCheck size={16}/> The key is written directly to the OS credential vault. Chat requests send only a scoped credential handle, never the secret itself.</div><div className="modal-actions"><button className="secondary-btn" onClick={() => void deleteProviderKey()} disabled={!hasProviderKey}>Delete saved key</button><button className="primary-btn" onClick={() => void saveProviderSettings()}><Check size={15}/> Save settings</button></div></section></div>}
  </div>;
}