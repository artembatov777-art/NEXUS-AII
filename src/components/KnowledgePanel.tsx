import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileText, Search, Upload, X } from "lucide-react";
import { DocumentIngestionService } from "../core/documentIngestion";
import { parseKnowledgeFile } from "../lib/documentParsers";
import { KnowledgeRetrievalService, type KnowledgeCitation } from "../core/knowledge";
import { ProjectService, type ProjectId, type WorkspaceProject } from "../core/projects";
import { LocalStorageKnowledgeRepository } from "../lib/knowledgeStorage";
import { LocalStorageProjectRepository } from "../lib/projectStorage";

export function KnowledgePanel({ onClose }: { onClose: () => void }) {
  const projects = useMemo(() => new ProjectService(
    new LocalStorageProjectRepository(window.localStorage),
    () => crypto.randomUUID() as ProjectId,
    () => Date.now()
  ), []);
  const repository = useMemo(() => new LocalStorageKnowledgeRepository(window.localStorage), []);
  const ingestion = useMemo(() => new DocumentIngestionService(repository), [repository]);
  const retrieval = useMemo(() => new KnowledgeRetrievalService(repository), [repository]);
  const [items, setItems] = useState<WorkspaceProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<KnowledgeCitation[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void projects.list().then(result => {
      if (result.ok) {
        setItems(result.value);
        setProjectId(current => current || result.value[0]?.id || "");
      } else setError(result.error.message);
    });
  }, [projects]);

  async function importFile(file?: File) {
    if (!file || !projectId || working) return;
    setWorking(true); setError(""); setStatus("");
    try {
      const parsed = await parseKnowledgeFile(file);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectId + ":" + file.name.toLocaleLowerCase()));
      const documentId = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
      const result = await ingestion.ingest({
        id: documentId, projectId, fileName: file.name,
        mediaType: parsed.mediaType, content: parsed.content, pages: parsed.pages
      });
      if (!result.ok) setError(result.error.message);
      else setStatus(`Imported ${result.value.fileName}: ${result.value.chunkCount} searchable chunks (${result.value.characterCount.toLocaleString()} characters).`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this file.");
    } finally { setWorking(false); }
  }

  async function searchKnowledge() {
    if (!projectId || !query.trim() || working) return;
    setWorking(true); setError(""); setAnswer(""); setCitations([]);
    const result = await retrieval.retrieve(query, projectId, 8);
    if (!result.ok) setError(result.error.message);
    else {
      setAnswer(result.value.context || "No matching passages were found in this project's documents.");
      setCitations(result.value.citations);
    }
    setWorking(false);
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="knowledge-modal" role="dialog" aria-modal="true" aria-labelledby="knowledge-title">
      <header className="memory-header">
        <div><div className="eyebrow">PROJECT KNOWLEDGE</div><h2 id="knowledge-title"><BookOpen size={21}/> Knowledge base</h2><p>Import text documents and retrieve passages with source references.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close knowledge"><X size={18}/></button>
      </header>
      <label className="knowledge-project">Project
        <select value={projectId} onChange={e => { setProjectId(e.target.value); setAnswer(""); setCitations([]); }}>
          {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {items.length === 0 ? <div className="memory-empty">Create a project first. Knowledge is isolated by project.</div> : <>
        <div className="knowledge-import">
          <div><strong><FileText size={15}/> Import a document</strong><p>Plain text and Markdown, up to 1 MB per file.</p></div>
          <label className="primary-btn"><Upload size={14}/> {working ? "Processing…" : "Choose file"}
            <input type="file" accept=".txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={working} onChange={e => { void importFile(e.target.files?.[0]); e.currentTarget.value = ""; }}/>
          </label>
        </div>
        <div className="knowledge-search">
          <label>Search project knowledge</label>
          <div><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void searchKnowledge(); }} placeholder="e.g. What are the core architecture decisions?"/>
          <button className="primary-btn" disabled={!query.trim() || working} onClick={() => void searchKnowledge()}><Search size={14}/> Search</button></div>
        </div>
      </>}
      {status && <div className="knowledge-status">{status}</div>}
      {error && <div className="error-banner">{error}</div>}
      {answer && <div className="knowledge-results"><h3>Retrieved context</h3><pre>{answer}</pre>{citations.length > 0 && <div className="knowledge-citations"><strong>Sources</strong>{citations.map(c => <div key={c.chunkId}>{c.sourceLabel}{c.page ? ` · page ${c.page}` : ""}{c.section ? ` · ${c.section}` : ""}</div>)}</div>}</div>}
      <footer className="project-footnote">Stored locally in this browser profile. Imports support TXT, Markdown, PDF, and DOCX. Re-importing a file with the same name in the same project replaces its previous index.</footer>
    </section>
  </div>;
}
