import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Bot, BookOpen, Check, ChevronDown, Command, Cpu, FlaskConical, FolderKanban, Menu, MessageSquare, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2, X, Zap, Copy, ClipboardPaste, FolderOpen, Plug } from "lucide-react";
import { sendMessage } from "./lib/ai";
import { MemoryPanel } from "./components/MemoryPanel";
import { GlobalSearchPanel } from "./components/GlobalSearchPanel";
import { AgentControlCenter } from "./components/AgentControlCenter";
import { ProjectPanel } from "./components/ProjectPanel";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { TrainingLabPanel } from "./components/TrainingLabPanel";
import { FileSystemPanel } from "./components/FileSystemPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { loadConversations, loadProvider, saveConversations, saveProvider } from "./lib/storage";
import { ProjectService, type ProjectId, type WorkspaceProject } from "./core/projects";
import { KnowledgeRetrievalService } from "./core/knowledge";
import { WorkspaceProjectRepository } from "./lib/projectStorage";
import { WorkspaceKnowledgeRepository, WorkspaceMemoryRepository } from "./lib/nativeRepositories";
import { MemoryService, type MemoryId } from "./core/memory";
import { matchesNewConversationShortcut } from "./lib/keyboardShortcuts";
import { resolveDialogKeyboardAction } from "./lib/dialogKeyboard";

import { LocalTransformerEmbeddingProvider } from "./lib/localEmbeddings";
import { IndexedDbKnowledgeVectorIndex } from "./lib/knowledgeVectorIndex";
import type { ChatMessage, Conversation, ProviderSettings } from "./types";

type ProviderVaultStatus = "loading" | "available" | "missing" | "unavailable" | "browser";
type ProviderConnectionState = "unchecked" | "checking" | "reachable" | "failed";

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
  const [providerVaultStatus, setProviderVaultStatus] = useState<ProviderVaultStatus>("loading");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [providerConnectionState, setProviderConnectionState] = useState<ProviderConnectionState>("unchecked");
  const [providerConnectionMessage, setProviderConnectionMessage] = useState("The endpoint has not been checked in this session.");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [trainingLabOpen, setTrainingLabOpen] = useState(false);
  const [fileSystemOpen, setFileSystemOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const chatAbortController = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const breakpoint = window.matchMedia("(max-width: 640px)");
    const syncNavigation = () => setSidebarOpen(!breakpoint.matches);
    breakpoint.addEventListener("change", syncNavigation);
    return () => breakpoint.removeEventListener("change", syncNavigation);
  }, []);
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
    let active = true;
    void reconcileSemanticIndex(() => active).catch(() => undefined);
    return () => { active = false; };
  }, [knowledgeRepository, embeddings, vectors]);


  useEffect(() => {
    let mounted = true;
    void loadConversations().then(items => { if (mounted) { setConversations(items); setConversationsReady(true); } }).catch(e => { if (mounted) { setError(e instanceof Error ? e.message : "Could not load conversations."); setConversationsReady(true); } });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { if (conversationsReady) void saveConversations(conversations).catch(e => setError(e instanceof Error ? e.message : "Could not save conversations.")); }, [conversations, conversationsReady]);
  useEffect(() => { saveProvider(provider); }, [provider]);
  useEffect(() => {
    if (!isTauri()) { setProviderVaultStatus("browser"); setHasProviderKey(false); return; }
    void invoke<ProviderVaultStatus>("provider_vault_status").then(status => {
      const safeStatus: ProviderVaultStatus = ["available", "missing", "unavailable"].includes(status) ? status : "unavailable";
      setProviderVaultStatus(safeStatus);
      setHasProviderKey(safeStatus === "available");
    }).catch(() => { setProviderVaultStatus("unavailable"); setHasProviderKey(false); });
  }, []);
  useEffect(() => { invoke<string>("get_app_version").then(setAppVersion).catch(() => undefined); }, []);

  const active = useMemo(() => conversations.find(c => c.id === activeId) ?? null, [conversations, activeId]);
  const messages = active?.messages ?? [welcome];
  // The gateway may be local while routing to a cloud model. Never infer
  // inference locality from the gateway hostname; use the owner's explicit model route.
  const providerRoute = provider.inferenceLocation;
  const localNoAuth = provider.credentialHandle === "none";

  function closeMobileNavigation() {
    if (window.matchMedia("(max-width: 640px)").matches) setSidebarOpen(false);
  }

  function dismissMobileNavigation() {
    setSidebarOpen(false);
    document.querySelector<HTMLElement>('[aria-controls="nexus-sidebar"]')?.focus();
  }

  function newChat() {
    if (!conversationsReady) return;
    closeMobileNavigation();
    const item: Conversation = { id: makeId(), title: "New conversation", messages: [welcome], updatedAt: Date.now(), ...(selectedProjectId ? { projectId: selectedProjectId } : {}) };
    setConversations(current => [item, ...current]);
    setActiveId(item.id);
    setError("");
  }

  useEffect(() => {
    function handleKeyboardShortcut(event: KeyboardEvent) {
      if (event.key === "Escape" && sidebarOpen && window.matchMedia("(max-width: 640px)").matches) {
        event.preventDefault();
        dismissMobileNavigation();
        return;
      }
      if (!matchesNewConversationShortcut(event)) return;
      event.preventDefault();
      newChat();
    }
    window.addEventListener("keydown", handleKeyboardShortcut);
    return () => window.removeEventListener("keydown", handleKeyboardShortcut);
  }, [conversationsReady, selectedProjectId, sidebarOpen]);

  // Keep keyboard focus inside the active workspace dialog and make Escape a
  // consistent close action across every module.
  useEffect(() => {
    const dialogOpen = settingsOpen || memoryOpen || globalSearchOpen || agentsOpen ||
      projectsOpen || knowledgeOpen || trainingLabOpen || fileSystemOpen || toolsOpen;
    if (!dialogOpen) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const getFocusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter(element => !element.closest('[hidden], [aria-hidden="true"]'));

    const focusTarget = dialog?.querySelector<HTMLElement>("[autofocus]") ?? getFocusable()[0];
    focusTarget?.focus();

    function handleDialogKeys(event: KeyboardEvent) {
      const focusable = getFocusable();
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const action = resolveDialogKeyboardAction(event.key, event.shiftKey, activeIndex, focusable.length);
      if (!action) return;
      event.preventDefault();
      if (action.type === "close") {
        event.stopPropagation();
        if (globalSearchOpen) setGlobalSearchOpen(false);
        else if (agentsOpen) setAgentsOpen(false);
        else if (fileSystemOpen) setFileSystemOpen(false);
        else if (toolsOpen) setToolsOpen(false);
        else if (trainingLabOpen) setTrainingLabOpen(false);
        else if (knowledgeOpen) setKnowledgeOpen(false);
        else if (projectsOpen) setProjectsOpen(false);
        else if (memoryOpen) setMemoryOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
      } else if (action.type === "focus") {
        focusable[action.index]?.focus();
      }
    }

    window.addEventListener("keydown", handleDialogKeys, true);
    return () => {
      window.removeEventListener("keydown", handleDialogKeys, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) {
        if (previousFocus.closest(".sidebar.sidebar-hidden")) {
          document.querySelector<HTMLElement>('[aria-controls="nexus-sidebar"]')?.focus();
        } else {
          previousFocus.focus();
        }
      }
    };
  }, [settingsOpen, memoryOpen, globalSearchOpen, agentsOpen, projectsOpen, knowledgeOpen, trainingLabOpen, fileSystemOpen, toolsOpen]);
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
    const controller = new AbortController();
    chatAbortController.current = controller;
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
      const assistantId = makeId();
      let streamedAnswer = "";
      const answer = await sendMessage(provider, next, contextParts.join("\n\n"), delta => {
        streamedAnswer += delta;
        updateMessages(target!.id, [...next, {
          id: assistantId, role: "assistant", content: streamedAnswer, createdAt: Date.now(),
          ...(sourceReferences.length ? { sourceReferences } : {})
        }]);
      }, controller.signal);
      updateMessages(target.id, [...next, { id: assistantId, role: "assistant", content: answer, createdAt: Date.now(), ...(sourceReferences.length ? { sourceReferences } : {}) }]);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (chatAbortController.current === controller) chatAbortController.current = null;
      setBusy(false);
    }
  }
  function removeConversation(id: string) {
    setConversations(current => current.filter(c => c.id !== id));
    if (activeId === id) setActiveId(null);
  }


  async function loadProviderModels() {
    if (!isTauri()) {
      setError("Model discovery is available only in the native desktop app.");
      return;
    }
    if (!localNoAuth && providerVaultStatus !== "available") {
      setError("Save an API key in the OS credential vault first, or select a loopback local runtime.");
      return;
    }
    setModelsLoading(true);
    setProviderConnectionState("checking");
    setProviderConnectionMessage("Requesting the model catalog from the configured endpoint…");
    try {
      const models = await invoke<string[]>("list_provider_models", {
        baseUrl: provider.baseUrl,
        credentialHandle: provider.credentialHandle ?? "default"
      });
      const safeModels = Array.isArray(models)
        ? [...new Set(models.filter(id => typeof id === "string" && id.trim().length > 0 && id.length <= 128))]
        : [];
      setAvailableModels(safeModels);
      if (safeModels.length === 0) {
        setProviderConnectionState("failed");
        setProviderConnectionMessage("The endpoint responded, but returned no usable model IDs.");
        setError("The endpoint returned no usable model IDs.");
      } else {
        setProviderConnectionState("reachable");
        setProviderConnectionMessage(`/models responded with ${safeModels.length} model ID(s). Chat generation has not been tested.`);
        setError("");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setProviderConnectionState("failed");
      setProviderConnectionMessage(message);
      setError(message);
    } finally {
      setModelsLoading(false);
    }
  }

  async function saveProviderSettings() {
    try {
      if (apiKey.trim() && !localNoAuth) { await invoke("store_provider_key", { apiKey }); setApiKey(""); setHasProviderKey(true); setProviderVaultStatus("available"); }
      saveProvider(provider);
      setSettingsOpen(false);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save provider credentials."); }
  }
  async function deleteProviderKey() {
    try { await invoke("delete_provider_key"); setHasProviderKey(false); setProviderVaultStatus("missing"); setApiKey(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove provider credentials."); }
  }


  async function reconcileSemanticIndex(isActive: () => boolean = () => true) {
    const loaded = await knowledgeRepository.exportAll();
    if (!loaded.ok || !isActive()) return;
    const missing = await vectors.reconcile(loaded.value);
    for (let offset = 0; offset < missing.length; offset += 16) {
      if (!isActive()) return;
      const batch = missing.slice(offset, offset + 16);
      const embedded = await embeddings.embed(batch.map(chunk => chunk.text));
      if (!embedded.ok || embedded.value.length !== batch.length) return;
      await Promise.all(batch.map((chunk, index) => vectors.upsert(chunk, embedded.value[index])));
    }
  }
  async function exportWorkspaceBackup() {
    try {
      const backup = await invoke<Record<string, unknown>>("export_workspace");
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `nexus-au-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not export workspace backup.");
    }
  }

  async function importWorkspaceBackup(file?: File) {
    if (!file) return;
    if (file.size > 60 * 1024 * 1024) { setError("Backup file exceeds the 60 MB limit."); return; }
    try {
      const backup: unknown = JSON.parse(await file.text());
      if (!backup || typeof backup !== "object" || (backup as { format?: unknown }).format !== "nexus-au-backup") {
        throw new Error("This file is not a NEXUS AU workspace backup.");
      }
      if (!window.confirm("Importing a backup replaces the current projects, conversations, memories, and knowledge. Export a backup of the current workspace first if you need to keep it. Continue?")) return;
      await invoke("import_workspace", { backup });
      // Database restore is authoritative. Vector maintenance is recoverable and
      // must not make a successful transactional restore appear to have failed.
      let vectorWarning = "";
      try {
        await vectors.clear();
        await reconcileSemanticIndex();
      } catch {
        vectorWarning = "Workspace restored, but the semantic index could not be rebuilt. Lexical document search remains available.";
      }
      const restored = await loadConversations();
      setConversations(restored);
      await refreshProjects();
      setActiveId(restored[0]?.id ?? null);
      setError(vectorWarning);
      setSettingsOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import workspace backup.");
    }
  }


  async function copyText(text: string) {
    try {
      if (isTauri()) await invoke("write_clipboard", { text });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("Clipboard access is unavailable in this browser context.");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not copy text."); }
  }
  async function pasteText() {
    try {
      const text = isTauri()
        ? await invoke<string>("read_clipboard")
        : navigator.clipboard?.readText
          ? await navigator.clipboard.readText()
          : (() => { throw new Error("Clipboard access is unavailable in this browser context."); })();
      setDraft(current => current ? current + text : text);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read clipboard."); }
  }

  return <div className="app-shell">
    <aside id="nexus-sidebar" className={`sidebar ${sidebarOpen ? "" : "sidebar-hidden"}`}>
      <div className="brand"><div className="brand-mark"><Sparkles size={18}/></div><div><strong>NEXUS</strong><span>AU WORKSPACE</span></div><button className="icon-btn mobile-only" onClick={dismissMobileNavigation} aria-label="Close navigation"><X size={17}/></button></div>
      <button className="new-chat" onClick={newChat} disabled={!conversationsReady}><Plus size={17}/> New conversation <span>⌘ K</span></button>
      <div className="nav-label">WORKSPACE</div>
      <button className="nav-item selected" aria-current="page" aria-label="Chat workspace"><MessageSquare size={17}/> Chat <span className="nav-count">{conversations.length}</span></button>
      <button className="nav-item" onClick={() => { setProjectsOpen(true); closeMobileNavigation(); }}><FolderKanban size={17}/> Projects</button>
      <button className="nav-item" onClick={() => { setMemoryOpen(true); closeMobileNavigation(); }}><Sparkles size={17}/> Memory</button>
      <button className="nav-item" onClick={() => { setKnowledgeOpen(true); closeMobileNavigation(); }}><BookOpen size={17}/> Knowledge base</button>
      <div className="nav-label nav-label-spaced">INTELLIGENCE</div>
      <button className="nav-item" onClick={() => { setAgentsOpen(true); closeMobileNavigation(); }}><Bot size={17}/> Agents <span className="nav-feature-dot"/></button>
      <button className="nav-item" onClick={() => { setTrainingLabOpen(true); closeMobileNavigation(); }}><FlaskConical size={17}/> Training Lab</button>
      <button className="nav-item" onClick={() => { setToolsOpen(true); closeMobileNavigation(); }}><Plug size={17}/> Tools & MCP</button>
      <div className="nav-label nav-label-spaced">SYSTEM</div>
      <button className="nav-item" onClick={() => { setFileSystemOpen(true); closeMobileNavigation(); }}><FolderOpen size={17}/> File system</button>
      <button className="nav-item" onClick={() => { setSettingsOpen(true); closeMobileNavigation(); }}><Cpu size={17}/> Models & providers</button>
      <div className="history-heading"><span>RECENT</span><div><button className="icon-btn" onClick={() => { setGlobalSearchOpen(true); closeMobileNavigation(); }} title="Search all workspace data" aria-label="Search all workspace data"><Search size={14}/></button><button className="icon-btn" onClick={() => {
        if (!conversations.length) return;
        if (window.confirm("Delete all conversations? This cannot be undone.")) {
          setConversations([]);
          setActiveId(null);
        }
      }} title="Clear all history" aria-label="Clear all conversation history"><Trash2 size={14}/></button></div></div>
      <div className="history-search"><Search size={13}/><input aria-label="Search conversation history" value={historyQuery} onChange={e => setHistoryQuery(e.target.value)} placeholder="Search history…"/></div>
      <div className="history-list">
        {conversations.filter(c => (c.projectId ?? "") === selectedProjectId && (c.title+" "+c.messages.map(m=>m.content).join(" ")).toLocaleLowerCase().includes(historyQuery.toLocaleLowerCase())).map(c => <div className={`history-row ${activeId === c.id ? "active" : ""}`} key={c.id}><button onClick={() => { setActiveId(c.id); setSelectedProjectId(c.projectId ?? ""); setError(""); closeMobileNavigation(); }}><MessageSquare size={14}/><span>{c.title}</span></button><button className="delete-chat" onClick={() => removeConversation(c.id)} aria-label="Delete conversation"><X size={13}/></button></div>)}
        {conversations.filter(c => (c.projectId ?? "") === selectedProjectId).length === 0 && <p className="empty-history">No conversations in this workspace yet.</p>}
      </div>
      <div className="sidebar-bottom"><div className="secure-line"><ShieldCheck size={15}/> Local conversation storage</div><button className="profile-row" onClick={() => { setSettingsOpen(true); closeMobileNavigation(); }}><div className="avatar">N</div><div><strong>NEXUS AU</strong><span>Version {appVersion}</span></div><Settings2 size={16}/></button></div>
    </aside>
    {sidebarOpen && <button className="sidebar-scrim" onClick={dismissMobileNavigation} aria-label="Close navigation"/>}

    <main className="main-panel">
      <header className="topbar"><div className="top-left"><button className="icon-btn" onClick={() => setSidebarOpen(v => !v)} aria-label={sidebarOpen ? "Close navigation" : "Open navigation"} aria-expanded={sidebarOpen} aria-controls="nexus-sidebar"><Menu size={18}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>Chat</strong></div></div><div className="top-right"><div className="runtime-indicator" title={isTauri() ? "Native desktop shell detected" : "Browser preview; native system integrations are unavailable"}><span className={`runtime-dot ${isTauri() ? "native" : "preview"}`}/>{isTauri() ? "DESKTOP" : "WEB PREVIEW"}</div><button type="button" className="model-pill" onClick={() => setSettingsOpen(true)} title={providerRoute === "remote" ? "Declared remote route: your message and selected context may be processed outside this device." : "Declared local route: NEXUS cannot verify OmniRoute backend locality. Verify the selected model's actual provider route before sending private context."} aria-label={`${providerRoute === "remote" ? "Declared remote" : "Declared local"} model route ${provider.model}`}><span className="status-dot"/>{providerRoute === "remote" ? "REMOTE" : "LOCAL*"} · {provider.model}<ChevronDown size={14}/></button><button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings2 size={18}/></button></div></header>
      <section className="chat-area">
        <div className="chat-heading"><div className="eyebrow"><span/> PERSONAL AI ENVIRONMENT</div><div className="nexus-hero-core" aria-label="NEXUS system core"><div className="core-orbit orbit-one"/><div className="core-orbit orbit-two"/><div className="core-orbit orbit-three"/><div className="core-crosshair"/><div className="core-glow"/><div className="core-center"><span>N</span></div><div className="core-label core-label-top">NEXUS CORE <b>INTERFACE</b></div><div className="core-label core-label-bottom">NEXUS AU <span>·</span> SYSTEM INTERFACE</div></div><h1>{active?.title ?? "Your intelligence. Connected."}</h1><p>Your models, tools and ideas. Connected in one workspace.</p>
          <div className="nexus-system-grid" aria-label="System overview">
            <article className="nexus-system-card"><span className="nexus-card-label">MODEL ROUTE</span><strong>{providerRoute === "remote" ? "REMOTE" : "LOCAL*"}</strong><small>{provider.model || "No model selected"}</small><i className="nexus-card-indicator"/></article>
            <article className="nexus-system-card"><span className="nexus-card-label">CREDENTIAL VAULT</span><strong>{localNoAuth ? "NOT REQUIRED" : providerVaultStatus === "available" ? "READY" : providerVaultStatus === "loading" ? "CHECKING" : providerVaultStatus === "browser" ? "PREVIEW" : "NOT READY"}</strong><small>{localNoAuth ? "Local loopback · no key" : providerVaultStatus === "available" ? "Key stored securely" : providerVaultStatus === "browser" ? "Native app required" : "Provider key status"}</small><i className={`nexus-card-indicator ${localNoAuth || providerVaultStatus === "available" ? "ready" : ""}`}/></article>
            <article className="nexus-system-card"><span className="nexus-card-label">WORKSPACE</span><strong>{workspaceProjects.length} PROJECTS</strong><small>{conversations.length} conversations</small><i className="nexus-card-indicator"/></article>
            <article className="nexus-system-card"><span className="nexus-card-label">CURRENT ACTIVITY</span><strong>{busy ? "PROCESSING" : "STANDBY"}</strong><small>{busy ? "Generating a response" : "Waiting for input"}</small><i className={`nexus-card-indicator ${busy ? "active" : ""}`}/></article>
          </div>
          <label className="chat-project-context">Project context
            <select value={selectedProjectId} onChange={e => { setSelectedProjectId(e.target.value); setActiveId(null); setError(""); }}>
              <option value="">No project context</option>
              {workspaceProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          {active && <button className="workspace-move" onClick={() => { setConversations(current => current.map(item => item.id === active.id ? (selectedProjectId ? { ...item, projectId: selectedProjectId, updatedAt: Date.now() } : { id: item.id, title: item.title, messages: item.messages, updatedAt: Date.now() }) : item)); setActiveId(null); }}>Move conversation here</button>}
        </div>
        <div className="messages">
          {messages.map(m => <div className={`message ${m.role}`} key={m.id}><div className="message-avatar">{m.role === "assistant" ? <Sparkles size={16}/> : "Y"}</div><div className="message-body"><div className="message-author">{m.role === "assistant" ? "NEXUS" : "YOU"} <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>{m.role === "assistant" && <button className="icon-btn" onClick={() => void copyText(m.content)} aria-label="Copy response"><Copy size={13}/></button>}</div><div className="message-content" aria-live={m.role === "assistant" ? "polite" : undefined}>{m.content}</div>{m.sourceReferences?.length ? <div className="message-sources"><strong>Sources</strong>{m.sourceReferences.map(source => <span key={source.chunkId}>{source.sourceLabel}{source.page ? ` · p. ${source.page}` : ""}{source.section ? ` · ${source.section}` : ""}</span>)}</div> : null}</div></div>)}
          {busy && <div className="message assistant"><div className="message-avatar"><Sparkles size={16}/></div><div className="message-body"><div className="message-author">NEXUS</div><div className="typing" role="status" aria-live="polite"><i/><i/><i/> Generating response…</div></div></div>}
          {error && <div className="error-banner">{error}</div>}
        </div>
        {!active && <div className="suggestions"><button onClick={() => setDraft("Help me plan the next development milestone for NEXUS AU.")}><Zap size={15}/> Plan a project <span>↗</span></button><button onClick={() => setDraft("Explain a complex technical concept in simple terms.")}><Command size={15}/> Learn something <span>↗</span></button><button onClick={() => setDraft("Review this idea and identify its biggest risks.")}><Bot size={15}/> Analyze an idea <span>↗</span></button></div>}
        <div className="composer-wrap"><div className="composer"><div className="composer-tools"><button className="icon-btn" onClick={() => void pasteText()} aria-label="Paste from system clipboard" title="Paste from clipboard"><ClipboardPaste size={15}/></button></div><textarea aria-label="Message NEXUS" aria-describedby="composer-note" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Message NEXUS… (Enter to send, Shift + Enter for newline)" rows={2}/><div className="composer-bottom"><span><ShieldCheck size={13}/> {localNoAuth ? "Local Ollama endpoint · no API key required" : providerVaultStatus === "available" ? "API key is stored in the OS credential vault" : providerVaultStatus === "unavailable" ? "OS credential vault unavailable · provider requests disabled" : providerVaultStatus === "browser" ? "Provider requests are disabled in browser preview" : providerVaultStatus === "loading" ? "Checking OS credential vault…" : "Provider key is not configured"}</span><button className="send-btn" disabled={!busy && (!draft.trim() || !conversationsReady)} onClick={() => busy ? chatAbortController.current?.abort() : void submit()}>{busy ? "Stop" : "Send"} {busy ? <X size={15}/> : <Send size={15}/>}</button></div></div><div className="composer-note" id="composer-note">NEXUS AU can make mistakes. Verify important information.</div></div>
      </section>
    </main>

    {globalSearchOpen && <GlobalSearchPanel conversations={conversations} projects={workspaceProjects} onClose={() => setGlobalSearchOpen(false)} onOpenConversation={conversation => { setSelectedProjectId(conversation.projectId ?? ""); setActiveId(conversation.id); setGlobalSearchOpen(false); setError(""); }} onOpenMemory={() => { setGlobalSearchOpen(false); setMemoryOpen(true); }} onOpenKnowledge={() => { setGlobalSearchOpen(false); setKnowledgeOpen(true); }} />}
    {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
    {projectsOpen && <ProjectPanel onClose={() => { setProjectsOpen(false); void refreshProjects(); }} onDeleted={async () => { await refreshProjects(); setConversations(await loadConversations()); await reconcileSemanticIndex(); }} />}
    {knowledgeOpen && <KnowledgePanel onClose={() => setKnowledgeOpen(false)} />}
    {trainingLabOpen && <TrainingLabPanel onClose={() => setTrainingLabOpen(false)} />}
    {fileSystemOpen && <FileSystemPanel onClose={() => setFileSystemOpen(false)} />}
    {toolsOpen && <ToolsPanel onClose={() => setToolsOpen(false)} />}
    {agentsOpen && <AgentControlCenter key={`${provider.baseUrl}|${provider.model}|${hasProviderKey}|${localNoAuth}`} onClose={() => setAgentsOpen(false)} providerSettings={provider} hasProviderKey={hasProviderKey || localNoAuth} />}
    {settingsOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title"><div className="modal-header"><div><div className="eyebrow">CONFIGURATION</div><h2 id="provider-settings-title">Provider settings</h2></div><button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18}/></button></div><p className="modal-description">Connect an OpenAI-compatible endpoint. Use OmniRoute for cloud routing or a loopback Ollama endpoint for local inference. Local no-key mode is restricted by the native host to localhost/loopback addresses. Cloud API keys are stored in the operating system credential vault.</p><div className="modal-actions"><button className="secondary-btn" onClick={() => { setProvider(p => ({ ...p, baseUrl: "http://127.0.0.1:20128/v1", model: "auto", inferenceLocation: "remote", credentialHandle: "default" })); setAvailableModels([]); setProviderConnectionState("unchecked"); setProviderConnectionMessage("The endpoint has not been checked in this session."); }}>Use OmniRoute (cloud)</button><button className="secondary-btn" onClick={() => { setProvider(p => ({ ...p, baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b", inferenceLocation: "local", credentialHandle: "none" })); setAvailableModels([]); setProviderConnectionState("unchecked"); setProviderConnectionMessage("The endpoint has not been checked in this session."); }}>Use Ollama (local)</button></div><label>Base URL<input value={provider.baseUrl} onChange={e => { setProvider(p => ({ ...p, baseUrl: e.target.value })); setAvailableModels([]); setProviderConnectionState("unchecked"); setProviderConnectionMessage("The endpoint has not been checked in this session."); }} placeholder="http://127.0.0.1:20128/v1"/></label><label>Declared inference location for selected model<select value={provider.inferenceLocation} onChange={e => setProvider(p => ({ ...p, inferenceLocation: e.target.value as ProviderSettings["inferenceLocation"] }))}><option value="remote">Remote cloud model (safe default)</option><option value="local">Local model (verify provider route)</option></select><small>This is an owner-declared disclosure setting, not a verified runtime fact. NEXUS cannot inspect whether OmniRoute forwards a request to a cloud provider. Localhost does not guarantee local inference.</small></label><label>Model ID<input list="provider-model-options" value={provider.model} onChange={e => setProvider(p => ({ ...p, model: e.target.value }))} placeholder="auto or provider/model-id"/><datalist id="provider-model-options">{availableModels.map(model => <option key={model} value={model}/>)}</datalist><small>{availableModels.length ? `${availableModels.length} models loaded from the configured endpoint.` : "Load model IDs from the configured /v1/models endpoint."}</small></label><div className="modal-actions"><button className="secondary-btn" onClick={() => void loadProviderModels()} disabled={!isTauri() || modelsLoading || (!localNoAuth && providerVaultStatus !== "available")}>{modelsLoading ? "Checking endpoint…" : "Check endpoint & load models"}</button></div><div className={`provider-connection ${providerConnectionState}`} role="status"><span className="provider-connection-dot"/><div><strong>{providerConnectionState === "checking" ? "CHECKING ENDPOINT" : providerConnectionState === "reachable" ? "MODEL CATALOG REACHABLE" : providerConnectionState === "failed" ? "ENDPOINT CHECK FAILED" : "ENDPOINT NOT CHECKED"}</strong><small>{providerConnectionMessage}</small></div></div><label>API key<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={localNoAuth ? "Not required for local Ollama" : hasProviderKey ? "Saved in OS credential vault" : "Enter API key"} autoComplete="off" disabled={localNoAuth || !isTauri() || providerVaultStatus === "unavailable"}/><small>{localNoAuth ? "No key is sent. This mode is accepted only for loopback endpoints by the native host." : providerVaultStatus === "available" ? "A provider key is saved in the OS credential vault on this device." : providerVaultStatus === "missing" ? "No provider key is saved." : providerVaultStatus === "unavailable" ? "The OS credential vault is unavailable. NEXUS will not fall back to plaintext storage. On Linux, check that your Secret Service/keyring session is running." : providerVaultStatus === "browser" ? "Browser preview does not store or send provider credentials. Use the native desktop app to connect a provider." : "Checking the OS credential vault…"}</small></label><div className="security-note"><ShieldCheck size={16}/> The key is written directly to the OS credential vault. Chat requests send only a scoped credential handle, never the secret itself. macOS uses Keychain, Windows uses Credential Manager, and Linux requires a working Secret Service-compatible keyring.</div><div className="modal-actions"><button className="secondary-btn" onClick={() => void deleteProviderKey()} disabled={!isTauri() || !hasProviderKey}>Delete saved key</button><button className="primary-btn" onClick={() => void saveProviderSettings()}><Check size={15}/> Save settings</button></div><div className="settings-backup"><h3>Workspace backup</h3><p>Export projects, conversations, memories, and knowledge. Provider credentials are never included.</p>{!isTauri() && <small>Backup import and export require the native desktop app. These controls are disabled in browser preview.</small>}<div className="modal-actions"><button className="secondary-btn" onClick={() => void exportWorkspaceBackup()} disabled={!isTauri()}>Export backup</button><label className="secondary-btn" aria-disabled={!isTauri()}>Import backup<input type="file" accept="application/json,.json" hidden disabled={!isTauri()} onChange={e => { void importWorkspaceBackup(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }}/></label></div></div></section></div>}
  </div>;
}