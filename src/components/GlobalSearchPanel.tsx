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
  const [chatResults, setChatResults] = useState<Conversation[]>([]);
  const [memoryResults, setMemoryResults] = useState<MemoryRecord[]>([]);
  const [knowledgeResults, setKnowledgeResults] = useState<Array<{ chunk: KnowledgeChunk; projectName: string }>>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function searchAll() {
    const term = query.trim();
    if (!term || working) return;
    setWorking(true);
    setError("");
    setChatResults(conversations.filter(item => (item.title + " " + item.messages.map(message => message.content).join(" ")).toLocaleLowerCase().includes(term.toLocaleLowerCase())).slice(0, 12));
    try {
      const [memoryResult, projectResults] = await Promise.all([
        memories.search(term, "all", 12),
        Promise.all(projects.slice(0, 50).map(async project => ({
          projectName: project.name,
          result: await knowledge.search(term, project.id, 5)
        })))
      ]);
      if (!memoryResult.ok) throw new Error(memoryResult.error.message);
      setMemoryResults(memoryResult.value);
      const found: Array<{ chunk: KnowledgeChunk; projectName: string }> = [];
      for (const item of projectResults) {
        if (!item.result.ok) throw new Error(item.result.error.message);
        for (const chunk of item.result.value) found.push({ chunk, projectName: item.projectName });
      }
      setKnowledgeResults(found.slice(0, 15));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setWorking(false);
    }
  }

  return <div className="modal-backdrop global-search-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="global-search-modal" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
      <header className="memory-header">
        <div><div className="eyebrow">WORKSPACE SEARCH</div><h2 id="global-search-title"><Search size={20}/> Search everything</h2><p>Conversations, saved memories and project documents.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close search"><X size={18}/></button>
      </header>
      <form className="global-search-form" onSubmit={event => { event.preventDefault(); void searchAll(); }}>
        <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search all workspace data…" />
        <button className="primary-btn" disabled={!query.trim() || working}><Search size={14}/>{working ? "Searching…" : "Search"}</button>
      </form>
      {error && <div className="error-banner">{error}</div>}
      <div className="global-search-results">
        {chatResults.length > 0 && <section><h3><MessageSquare size={14}/> Conversations <span>{chatResults.length}</span></h3>{chatResults.map(item => <button className="global-search-result" key={item.id} onClick={() => onOpenConversation(item)}><strong>{item.title}</strong><small>{item.messages.length} messages · {projects.find(p => p.id === item.projectId)?.name ?? "Personal workspace"}</small></button>)}</section>}
        {memoryResults.length > 0 && <section><h3><Brain size={14}/> Memories <span>{memoryResults.length}</span></h3>{memoryResults.map(item => <button className="global-search-result" key={item.id} onClick={onOpenMemory}><strong>{item.content}</strong><small>{item.category} · {item.scope}</small></button>)}</section>}
        {knowledgeResults.length > 0 && <section><h3><BookOpen size={14}/> Project documents <span>{knowledgeResults.length}</span></h3>{knowledgeResults.map(({chunk,projectName}) => <button className="global-search-result" key={chunk.id} onClick={onOpenKnowledge}><strong>{chunk.sourceLabel}</strong><small>{projectName} · {chunk.text.slice(0,180)}</small></button>)}</section>}
        {!working && query.trim() && !error && chatResults.length===0 && memoryResults.length===0 && knowledgeResults.length===0 && <p className="global-search-empty">No matching conversations, memories or document passages.</p>}
        {!query.trim() && <p className="global-search-empty">Search across every project, conversation and saved context.</p>}
      </div>
    </section>
  </div>;
}
