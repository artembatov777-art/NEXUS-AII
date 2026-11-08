import { useEffect, useMemo, useState } from "react";
import { Brain, Plus, Search, Trash2, X } from "lucide-react";
import { MemoryService, type MemoryCategory, type MemoryRecord, type MemoryScope, type MemoryId } from "../core/memory";
import { LocalStorageMemoryRepository } from "../lib/memoryStorage";

interface MemoryPanelProps {
  onClose: () => void;
}

export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const service = useMemo(() => new MemoryService(
    new LocalStorageMemoryRepository(window.localStorage),
    { memoryId: () => crypto.randomUUID() as MemoryId },
    { now: () => Date.now() }
  ), []);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("fact");
  const [scope, setScope] = useState<Exclude<MemoryScope, "all">>("profile");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh(search = query) {
    const result = search.trim()
      ? await service.search(search, "all", 50)
      : await service.list("all", 50);
    if (result.ok) {
      setRecords(result.value);
      setError("");
    } else {
      setError(result.error.message);
    }
  }

  useEffect(() => { void refresh(""); }, []);

  async function saveMemory() {
    if (!content.trim() || saving) return;
    setSaving(true);
    const result = await service.remember({
      content,
      category,
      scope,
      source: { type: "user_confirmed", label: "Added manually by user" },
      tags: tags.split(",")
    }, { confirmedByUser: true });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setContent("");
    setTags("");
    await refresh("");
  }

  async function removeMemory(id: MemoryId) {
    const result = await service.forget(id);
    if (!result.ok) setError(result.error.message);
    else await refresh();
  }

  return <div className="modal-backdrop memory-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="memory-modal" role="dialog" aria-modal="true" aria-labelledby="memory-title">
      <header className="memory-header">
        <div><div className="eyebrow">PERSONAL CONTEXT</div><h2 id="memory-title"><Brain size={21}/> Memory</h2><p>Information NEXUS can retrieve in future conversations.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close memory"><X size={18}/></button>
      </header>

      <div className="memory-search"><Search size={16}/><input value={query} onChange={event => {
        const value = event.target.value;
        setQuery(value);
        void refresh(value);
      }} placeholder="Search saved memories…"/></div>

      <div className="memory-list">
        {records.map(record => <article className="memory-record" key={record.id}>
          <div className="memory-record-top"><span>{record.category} · {record.scope}</span><button className="icon-btn" onClick={() => void removeMemory(record.id)} aria-label="Delete memory"><Trash2 size={15}/></button></div>
          <p>{record.content}</p>
          <div className="memory-record-meta">{record.tags.map(tag => <span key={tag}>#{tag}</span>)}<small>Source: {record.source.label}</small></div>
        </article>)}
        {records.length === 0 && <div className="memory-empty">No saved memories found. Add one below, or change your search.</div>}
      </div>

      <div className="memory-add">
        <h3><Plus size={16}/> Add a memory</h3>
        <textarea value={content} onChange={event => setContent(event.target.value)} placeholder="Example: I prefer explanations with practical examples…" rows={3}/>
        <div className="memory-fields">
          <label>Category<select value={category} onChange={event => setCategory(event.target.value as MemoryCategory)}>
            <option value="fact">Fact</option><option value="preference">Preference</option><option value="goal">Goal</option><option value="workflow">Workflow</option><option value="project">Project</option>
          </select></label>
          <label>Scope<select value={scope} onChange={event => setScope(event.target.value as Exclude<MemoryScope, "all">)}>
            <option value="profile">Profile</option><option value="project">Project</option><option value="conversation">Conversation</option>
          </select></label>
        </div>
        <input className="memory-tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="Tags, separated by commas"/>
        {error && <div className="error-banner memory-error">{error}</div>}
        <div className="memory-footer"><span>Saved locally on this device. You control deletion.</span><button className="primary-btn" disabled={!content.trim() || saving} onClick={() => void saveMemory()}>{saving ? "Saving…" : "Save memory"}</button></div>
      </div>
    </section>
  </div>;
}
