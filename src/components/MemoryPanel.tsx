import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Plus, Search, Trash2, X, Pencil, Check, Download } from "lucide-react";
import { MemoryService, type MemoryCategory, type MemoryRecord, type MemoryScope, type MemoryId } from "../core/memory";
import { WorkspaceMemoryRepository } from "../lib/nativeRepositories";
import { ProjectService, type ProjectId, type WorkspaceProject } from "../core/projects";
import { WorkspaceProjectRepository } from "../lib/projectStorage";

interface MemoryPanelProps {
  onClose: () => void;
}

export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const service = useMemo(() => new MemoryService(
    new WorkspaceMemoryRepository(window.localStorage),
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
  const projects = useMemo(() => new ProjectService(new WorkspaceProjectRepository(window.localStorage), () => crypto.randomUUID() as ProjectId, () => Date.now()), []);
  const [projectOptions, setProjectOptions] = useState<WorkspaceProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editSource, setEditSource] = useState("");
  const [editSourceReference, setEditSourceReference] = useState("");
  const [editCategory, setEditCategory] = useState<MemoryCategory>("fact");
  const [editScope, setEditScope] = useState<Exclude<MemoryScope, "all">>("profile");
  const [editProjectId, setEditProjectId] = useState("");
  const refreshSequence = useRef(0);

  async function refresh(search = query) {
    const requestId = ++refreshSequence.current;
    try {
      const result = search.trim()
        ? await service.search(search, "all", 50)
        : await service.list("all", 50);
      if (requestId !== refreshSequence.current) return;
      if (result.ok) {
        setRecords(result.value);
        setError("");
      } else {
        setError(result.error.message);
      }
    } catch (cause) {
      if (requestId === refreshSequence.current) {
        setError(cause instanceof Error ? cause.message : "Could not load saved memories.");
      }
    }
  }

  useEffect(() => { void refresh(""); void projects.list().then(result => { if (result.ok) setProjectOptions(result.value); }); }, [projects]);

  async function exportMemories() {
    const result = await service.exportAll();
    if (!result.ok) { setError(result.error.message); return; }
    const payload = JSON.stringify({ format: "nexus-au-memory-export", schemaVersion: 1, exportedAt: new Date().toISOString(), memories: result.value }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nexus-au-memories-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setError("");
  }

  async function saveMemory() {
    if (!content.trim() || saving) return;
    if (scope === "project" && !projectId) { setError("Select a project for this memory."); return; }
    setSaving(true);
    const result = await service.remember({
      content,
      category,
      scope,
      ...(scope === "project" ? { projectId } : {}),
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

  function beginEdit(record: MemoryRecord) { setEditing(record); setEditContent(record.content); setEditTags(record.tags.join(", ")); setEditSource(record.source.label); setEditSourceReference(record.source.referenceId ?? ""); setEditCategory(record.category); setEditScope(record.scope); setEditProjectId(record.projectId ?? ""); setError(""); }
  async function saveEdit() {
    if (!editing || saving) return;
    setSaving(true);
    const result = await service.revise(editing.id, { content: editContent, category: editCategory, scope: editScope, projectId: editScope === "project" ? editProjectId : undefined, tags: editTags.split(","), source: { ...editing.source, label: editSource, referenceId: editSourceReference.trim() || undefined } });
    setSaving(false);
    if (!result.ok) setError(result.error.message); else { setEditing(null); await refresh(""); }
  }
  async function removeMemory(id: MemoryId) {
    if (!window.confirm("Delete this saved memory? This cannot be undone.")) return;
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
        <div className="memory-header-actions"><button className="secondary-btn" onClick={() => void exportMemories()}><Download size={14}/> Export</button><button className="icon-btn" onClick={onClose} aria-label="Close memory"><X size={18}/></button></div>
      </header>

      <div className="memory-search"><Search size={16}/><input aria-label="Search saved memories" value={query} onChange={event => {
        const value = event.target.value;
        setQuery(value);
        void refresh(value);
      }} placeholder="Search saved memories…"/></div>

      <div className="memory-list">
        {records.map(record => <article className="memory-record" key={record.id}>
          <div className="memory-record-top"><span>{record.category} · {record.scope}</span><div><button className="icon-btn" onClick={() => beginEdit(record)} aria-label="Edit memory"><Pencil size={14}/></button><button className="icon-btn" onClick={() => void removeMemory(record.id)} aria-label="Delete memory"><Trash2 size={15}/></button></div></div>
          <p>{record.content}</p>
          {editing?.id === record.id && <div className="memory-edit-form">
            <textarea aria-label="Edit memory content" value={editContent} onChange={e => setEditContent(e.target.value)} rows={3}/>
            <div className="memory-fields"><label>Category<select value={editCategory} onChange={e => setEditCategory(e.target.value as MemoryCategory)}><option value="fact">Fact</option><option value="preference">Preference</option><option value="goal">Goal</option><option value="workflow">Workflow</option><option value="project">Project</option></select></label>
            <label>Scope<select value={editScope} onChange={e => setEditScope(e.target.value as Exclude<MemoryScope, "all">)}><option value="profile">Profile</option><option value="project">Project</option><option value="conversation">Conversation</option></select></label></div>
            {editScope === "project" && <label>Project<select value={editProjectId} onChange={e => setEditProjectId(e.target.value)}><option value="">Select project…</option>{projectOptions.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
            <input aria-label="Edit memory tags" value={editTags} onChange={e => setEditTags(e.target.value)} placeholder="Tags, separated by commas"/>
            <input aria-label="Edit memory source label" value={editSource} onChange={e => setEditSource(e.target.value)} placeholder="Source label"/>
            <input aria-label="Edit memory source reference" value={editSourceReference} onChange={e => setEditSourceReference(e.target.value)} placeholder="Source reference (optional)"/>
            <div><button className="secondary-btn" onClick={() => setEditing(null)}>Cancel</button><button className="primary-btn" disabled={!editContent.trim() || !editSource.trim() || saving || (editScope === "project" && !editProjectId)} onClick={() => void saveEdit()}><Check size={14}/> Save</button></div>
          </div>}
          <div className="memory-record-meta">{record.tags.map(tag => <span key={tag}>#{tag}</span>)}<small>Source: {record.source.label}</small></div>
        </article>)}
        {records.length === 0 && <div className="memory-empty">No saved memories found. Add one below, or change your search.</div>}
      </div>

      <div className="memory-add">
        <h3><Plus size={16}/> Add a memory</h3>
        <textarea aria-label="New memory content" value={content} onChange={event => setContent(event.target.value)} placeholder="Example: I prefer explanations with practical examples…" rows={3}/>
        <div className="memory-fields">
          <label>Category<select value={category} onChange={event => setCategory(event.target.value as MemoryCategory)}>
            <option value="fact">Fact</option><option value="preference">Preference</option><option value="goal">Goal</option><option value="workflow">Workflow</option><option value="project">Project</option>
          </select></label>
          <label>Scope<select value={scope} onChange={event => setScope(event.target.value as Exclude<MemoryScope, "all">)}>
            <option value="profile">Profile</option><option value="project">Project</option><option value="conversation">Conversation</option>
          </select></label>
        </div>
        {scope === "project" && <label>Project<select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">Select project…</option>{projectOptions.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
        <input className="memory-tags" aria-label="Memory tags" value={tags} onChange={event => setTags(event.target.value)} placeholder="Tags, separated by commas"/>
        {error && <div className="error-banner memory-error">{error}</div>}
        <div className="memory-footer"><span>Saved locally on this device. You control deletion.</span><button className="primary-btn" disabled={!content.trim() || saving} onClick={() => void saveMemory()}>{saving ? "Saving…" : "Save memory"}</button></div>
      </div>
    </section>
  </div>;
}
