import { useMemo, useState } from "react";
import { Search, MessageSquare, Brain, BookOpen, X } from "lucide-react";
import type { Conversation } from "../types";
import type { WorkspaceProject } from "../core/projects";
import { WorkspaceMemoryRepository, WorkspaceKnowledgeRepository } from "../lib/nativeRepositories";
import type { MemoryRecord } from "../core/memory";
import type { KnowledgeChunk } from "../core/knowledge";

export function GlobalSearchPanel({ conversations, projects, onClose, onOpenConversation, onOpenMemory, onOpenKnowledge }: {
  conversations: Conversation[];
  projects: WorkspaceProject[];
  onClose: () => void;
  onOpenConversation: (conversation: Conversation) => void;
  onOpenMemory: () => void;
  onOpenKnowledge: () => void;
}) {
  const memories = useMemo(() => new WorkspaceMemoryRepository(window.localStorage), []);
  const knowledge = useMemo(() => new WorkspaceKnowledgeRepository(window.localStorage), []);
  const [query, setQuery] = useState("");
  const [includeConversations, setIncludeConversations] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(true);
  const [includeKnowledge, setIncludeKnowledge] = useState(true);
  const [chatResults, setChatResults] = useState<Conversation[]>([]);
  const [memoryResults, setMemoryResults] = useState<MemoryRecord[]>([]);
  const [knowledgeResults, setKnowledgeResults] = useState<Array<{ chunk: KnowledgeChunk; projectName: string }>>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  function clearResults() {
    setChatResults([]);
    setMemoryResults([]);
    setKnowledgeResults([]);
    setError("");
  }

  async function searchAll() {
    const term = query.trim();
    if (!term || working) return;
    if (!includeConversations && !includeMemories && !includeKnowledge) {
      clearResults();
      setError("Select at least one search scope.");
      return;
    }
    setWorking(true);
    clearResults();
    try {
      const chat = includeConversations
        ? conversations.filter(item => (item.title + " " + item.messages.map(message => message.content).join(" "))
          .toLocaleLowerCase().includes(term.toLocaleLowerCase())).slice(0, 12)
        : [];
      const [memoryResult, knowledgeResult] = await Promise.all([
        includeMemories ? memories.search(term, "all", 12) : Promise.resolve(null),
        includeKnowledge ? knowledge.searchAll(term, 30) : Promise.resolve(null)
      ]);
      if (memoryResult && !memoryResult.ok) throw new Error(memoryResult.error.message);
      if (knowledgeResult && !knowledgeResult.ok) throw new Error(knowledgeResult.error.message);
      setChatResults(chat);
      setMemoryResults(memoryResult?.ok ? memoryResult.value : []);
      setKnowledgeResults(knowledgeResult?.ok ? knowledgeResult.value.slice(0, 15).map(chunk => ({
        chunk,
        projectName: projects.find(project => project.id === chunk.projectId)?.name ?? "Unknown project"
      })) : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setWorking(false);
    }
  }

  return <div className="modal-backdrop global-search-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="global-search-modal" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
      <header className="memory-header">
        <div><div className="eyebrow">WORKSPACE SEARCH</div><h2 id="global-search-title"><Search size={20}/> Search everything</h2><p>Choose which workspace data to search.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close search"><X size={18}/></button>
      </header>
      <form className="global-search-form" onSubmit={event => { event.preventDefault(); void searchAll(); }}>
        <input autoFocus value={query} onChange={event => { setQuery(event.target.value); clearResults(); }} placeholder="Search workspace data…" />
        <button className="primary-btn" disabled={!query.trim() || working}><Search size={14}/>{working ? "Searching…" : "Search"}</button>
      </form>
      <div className="global-search-scopes" aria-label="Search scopes">
        <label><input type="checkbox" checked={includeConversations} onChange={event => { setIncludeConversations(event.target.checked); clearResults(); }}/> Conversations</label>
        <label><input type="checkbox" checked={includeMemories} onChange={event => { setIncludeMemories(event.target.checked); clearResults(); }}/> Memories</label>
        <label><input type="checkbox" checked={includeKnowledge} onChange={event => { setIncludeKnowledge(event.target.checked); clearResults(); }}/> Project knowledge</label>
      </div>
      {error && <div className="error-banner">{error}</div>}
      <div className="global-search-results">
        {chatResults.length > 0 && <section><h3><MessageSquare size={14}/> Conversations <span>{chatResults.length}</span></h3>{chatResults.map(item => <button className="global-search-result" key={item.id} onClick={() => onOpenConversation(item)}><strong>{item.title}</strong><small>{item.messages.length} messages · {projects.find(p => p.id === item.projectId)?.name ?? "Personal workspace"}</small></button>)}</section>}
        {memoryResults.length > 0 && <section><h3><Brain size={14}/> Memories <span>{memoryResults.length}</span></h3>{memoryResults.map(item => <button className="global-search-result" key={item.id} onClick={onOpenMemory}><strong>{item.content}</strong><small>{item.category} · {item.scope}</small></button>)}</section>}
        {knowledgeResults.length > 0 && <section><h3><BookOpen size={14}/> Project documents <span>{knowledgeResults.length}</span></h3>{knowledgeResults.map(({chunk,projectName}) => <button className="global-search-result" key={chunk.id} onClick={onOpenKnowledge}><strong>{chunk.sourceLabel}</strong><small>{projectName} · {chunk.text.slice(0,180)}</small></button>)}</section>}
        {!working && query.trim() && !error && chatResults.length===0 && memoryResults.length===0 && knowledgeResults.length===0 && <p className="global-search-empty">No matching results in the selected scopes.</p>}
        {!query.trim() && <p className="global-search-empty">Search all projects, conversations and saved context, or narrow the scope above.</p>}
      </div>
    </section>
  </div>;
}
