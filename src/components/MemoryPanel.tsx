import { useEffect, useMemo, useState } from "react";
import { Brain, Plus, Search, Trash2, X, Pencil, Check } from "lucide-react";
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
  const [editingId, setEditingId] = useState<MemoryId | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState<MemoryCategory>("fact");
  const [editScope, setEditScope] = useState<Exclude<MemoryScope, "all">>("profile");
  const [editTags, setEditTags] = useState("");
  const [editSourceLabel, setEditSourceLabel] = useState("");
  const [editSourceReference, setEditSourceReference] = useState("");

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

  function beginEdit(record: MemoryRecord) {
    setEditingId(record.id); setEditContent(record.content); setEditCategory(record.category);
    setEditScope(record.scope); setEditTags(record.tags.join(", "));
    setEditSourceLabel(record.source.label); setEditSourceReference(record.source.referenceId ?? "");
    setError("");
  }

  async function saveEdit() {
    if (!editingId || saving) return;
    setSaving(true);
    const current = records.find(record => record.id === editingId);
    const result = await service.revise(editingId, {
      content: editContent, category: editCategory, scope: editScope,
      tags: editTags.split(","),
      source: { type: current?.source.type ?? "user_confirmed", label: editSourceLabel, referenceId: editSourceReference.trim() || undefined }
    });
    setSaving(false);
    if (!result.ok) { setError(result.error.message); return; }
    setEditingId(null); await refresh("");
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
          <div className="memory-record-top"><span>{record.category} · {record.scope}</span><div className="memory-record-actions"><button className="icon-btn" onClick={() => beginEdit(record)} aria-label="Edit memory"><Pencil size={14}/></button><button className="icon-btn" onClick={() => void removeMemory(record.id)} aria-label="Delete memory"><Trash2 size={15}/></button></div></div>
          <p>{record.content}</p>
          <div className="memory-record-meta">{record.tags.map(tag => <span key={tag}>#{tag}</span>)}<small>Source: {record.source.label}{record.source.referenceId ? ` · ${record.source.referenceId}` : ""}</small></div>
          {editingId === record.id && <div className="memory-edit-form">
            <textarea value={editContent} onChange={event => setEditContent(event.target.value)} rows={3}/>
            <div className="memory-fields">
              <label>Category<select value={editCategory} onChange={event => setEditCategory(event.target.value as MemoryCategory)}><option value="fact">Fact</option><option value="preference">Preference</option><option value="goal">Goal</option><option value="workflow">Workflow</option><option value="project">Project</option></select></label>
              <label>Scope<select value={editScope} onChange={event => setEditScope(event.target.value as Exclude<MemoryScope, "all">)}><option value="profile">Profile</option><option value="project">Project</option><option value="conversation">Conversation</option></select></label>
            </div>
            <input value={editTags} onChange={event => setEditTags(event.target.value)} placeholder="Tags, separated by commas"/>
            <input value={editSourceLabel} onChange={event => setEditSourceLabel(event.target.value)} placeholder="Source label"/>
            <input value={editSourceReference} onChange={event => setEditSourceReference(event.target.value)} placeholder="Source reference (optional)"/>
            <div className="memory-edit-actions"><button className="secondary-btn" onClick={() => setEditingId(null)}>Cancel</button><button className="primary-btn" disabled={!editContent.trim() || !editSourceLabel.trim() || saving} onClick={() => void saveEdit()}><Check size={14}/> Save changes</button></div>
          </div>}
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
