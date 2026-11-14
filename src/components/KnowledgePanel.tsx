import { useEffect, useMemo, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { BookOpen, FileText, Search, Upload, X, Trash2 } from "lucide-react";
import { DocumentIngestionService } from "../core/documentIngestion";
import { parseKnowledgeFile } from "../lib/documentParsers";
import { KnowledgeRetrievalService, type KnowledgeCitation } from "../core/knowledge";
import { ProjectService, type ProjectId, type WorkspaceProject } from "../core/projects";
import { WorkspaceKnowledgeRepository, type KnowledgeDocumentSummary } from "../lib/nativeRepositories";
import { WorkspaceProjectRepository } from "../lib/projectStorage";
import { LocalTransformerEmbeddingProvider } from "../lib/localEmbeddings";
import { IndexedDbKnowledgeVectorIndex } from "../lib/knowledgeVectorIndex";
import { collectWorkspaceKnowledgeFiles } from "../lib/workspaceKnowledgeImport";

export function KnowledgePanel({ onClose }: { onClose: () => void }) {
  const projects = useMemo(() => new ProjectService(
    new WorkspaceProjectRepository(window.localStorage),
    () => crypto.randomUUID() as ProjectId,
    () => Date.now()
  ), []);
  const repository = useMemo(() => new WorkspaceKnowledgeRepository(window.localStorage), []);
  const embeddings = useMemo(() => new LocalTransformerEmbeddingProvider(), []);
  const vectors = useMemo(() => new IndexedDbKnowledgeVectorIndex(), []);
  const ingestion = useMemo(() => new DocumentIngestionService(repository, {}, embeddings, vectors), [repository, embeddings, vectors]);
  const retrieval = useMemo(() => new KnowledgeRetrievalService(repository, embeddings, vectors), [repository, embeddings, vectors]);
  const [items, setItems] = useState<WorkspaceProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<KnowledgeCitation[]>([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [workspaceRoots, setWorkspaceRoots] = useState<string[]>([]);
  const [selectedWorkspaceRoot, setSelectedWorkspaceRoot] = useState("");
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);

  useEffect(() => {
    void projects.list().then(result => {
      if (result.ok) {
        setItems(result.value);
        setProjectId(current => current || result.value[0]?.id || "");
      } else setError(result.error.message);
    });
  }, [projects]);

  async function refreshDocuments(targetProjectId = projectId) {
    if (!targetProjectId) { setDocuments([]); return; }
    const result = await repository.listDocuments(targetProjectId);
    if (result.ok) setDocuments(result.value); else setError(result.error.message);
  }
  useEffect(() => { void refreshDocuments(); }, [projectId, repository]);

  async function removeDocument(documentId: string) {
    if (!projectId || working) return;
    if (!window.confirm("Remove this document and its indexed passages from the selected project?")) return;
    setWorking(true); setError(""); setStatus("");
    try {
      const result = await ingestion.remove(documentId, projectId);
      if (!result.ok) setError(result.error.message);
      else { setStatus("Document removed from this project's knowledge base."); await refreshDocuments(projectId); setAnswer(""); setCitations([]); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this document.");
    } finally { setWorking(false); }
  }

  async function importFiles(fileList?: FileList | null) {
    if (!fileList || !projectId || working) return;
    const selected = Array.from(fileList).slice(0, 20);
    const skipped = Math.max(0, fileList.length - selected.length);
    setWorking(true); setError(""); setStatus(`Preparing ${selected.length} document(s) for project indexing…`);
    const imported: string[] = [];
    const failures: string[] = [];
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        setStatus(`Importing ${index + 1}/${selected.length}: ${file.name}`);
        try {
          const parsed = await parseKnowledgeFile(file);
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectId + ":" + file.name.toLocaleLowerCase()));
          const documentId = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
          const result = await ingestion.ingest({
            id: documentId, projectId, fileName: file.name,
            mediaType: parsed.mediaType, content: parsed.content, pages: parsed.pages
          });
          if (!result.ok) failures.push(file.name + ": " + result.error.message);
          else imported.push(`${result.value.fileName} (${result.value.chunkCount} chunks)`);
        } catch (cause) {
          failures.push(file.name + ": " + (cause instanceof Error ? cause.message : "Could not read this file."));
        }
      }
      await refreshDocuments(projectId);
      setStatus(`Imported ${imported.length}/${selected.length} document(s). ${skipped ? `${skipped} extra file(s) were skipped by the 20-file batch limit. ` : ""}${imported.length ? imported.join("; ") : "No documents were imported."}`);
      if (failures.length) setError(failures.slice(0, 8).join("\n") + (failures.length > 8 ? `\n…and ${failures.length - 8} more error(s).` : ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Document batch import failed.");
    } finally { setWorking(false); }
  }

  async function importApprovedWorkspaceFolder() {
    if (!isTauri() || !selectedWorkspaceRoot || !projectId || working) return;
    setWorking(true); setError(""); setStatus("Scanning the explicitly approved workspace folder…");
    try {
      const scan = await collectWorkspaceKnowledgeFiles(selectedWorkspaceRoot, invoke);
      if (scan.files.length === 0) {
        setStatus(`No supported text files found. ${scan.skippedFiles} unsupported or oversized entries were skipped.`);
        return;
      }
      const totalMb = (scan.totalBytes / (1024 * 1024)).toFixed(1);
      if (!window.confirm(`Import ${scan.files.length} text files (${totalMb} MB) from this already-approved folder into the selected project knowledge base? Files remain on disk; NEXUS reads only supported text formats. Continue?`)) {
        setStatus("Workspace import cancelled.");
        return;
      }
      const imported: string[] = [];
      const failures: string[] = [];
      for (let index = 0; index < scan.files.length; index += 1) {
        const file = scan.files[index];
        setStatus(`Importing workspace file ${index + 1}/${scan.files.length}: ${file.name}`);
        try {
          const content = await invoke<string>("read_workspace_file", { path: file.path });
          const parsed = await parseKnowledgeFile(new File([content], file.name));
          const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectId + ":" + file.path.toLocaleLowerCase()));
          const documentId = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
          const result = await ingestion.ingest({
            id: documentId, projectId, fileName: file.name,
            mediaType: parsed.mediaType, content: parsed.content, pages: parsed.pages
          });
          if (!result.ok) failures.push(file.path + ": " + result.error.message);
          else imported.push(`${file.name} (${result.value.chunkCount} chunks)`);
        } catch (cause) {
          failures.push(file.path + ": " + (cause instanceof Error ? cause.message : "Could not read this workspace file."));
        }
      }
      await refreshDocuments(projectId);
      setStatus(`Workspace import: ${imported.length}/${scan.files.length} files indexed. ${scan.truncated ? "Scan limits were reached. " : ""}${scan.skippedFiles} unsupported or oversized entries skipped.`);
      if (failures.length) setError(failures.slice(0, 8).join("\\n") + (failures.length > 8 ? `\\n…and ${failures.length - 8} more error(s).` : ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import the approved workspace folder.");
    } finally { setWorking(false); }
  }

  async function rebuildSemanticIndex() {
    if (!projectId || working) return;
    setWorking(true); setError(""); setStatus("Checking the project's local semantic index and rebuilding missing vectors…");
    try {
      const result = await ingestion.rebuildSemanticIndex(projectId);
      if (!result.ok) setError(result.error.message);
      else setStatus(`Semantic index ready: ${result.value.totalChunks} passages checked, ${result.value.indexed} vectors rebuilt.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rebuild the semantic index.");
    } finally { setWorking(false); }
  }

  async function searchKnowledge() {
    if (!projectId || !query.trim() || working) return;
    setWorking(true); setError(""); setAnswer(""); setCitations([]);
    try {
      const result = await retrieval.retrieve(query, projectId, 8);
      if (!result.ok) setError(result.error.message);
      else {
        setAnswer(result.value.context || "No matching passages were found in this project's documents.");
        setCitations(result.value.citations);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Knowledge search failed.");
    } finally { setWorking(false); }
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="knowledge-modal" role="dialog" aria-modal="true" aria-labelledby="knowledge-title">
      <header className="memory-header">
        <div><div className="eyebrow">PROJECT KNOWLEDGE</div><h2 id="knowledge-title"><BookOpen size={21}/> Knowledge base</h2><p>Import text documents and retrieve passages with source references.</p></div>
        <button className="icon-btn" onClick={onClose} aria-label="Close knowledge"><X size={18}/></button>
      </header>
      <label className="knowledge-project">Project
        <select value={projectId} disabled={working} onChange={e => { setProjectId(e.target.value); setAnswer(""); setCitations([]); }}>
          {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {items.length === 0 ? <div className="memory-empty">Create a project first. Knowledge is isolated by project.</div> : <>
        <div className="knowledge-import">
          <div><strong><FileText size={15}/> Import documents</strong><p>TXT, Markdown, source code, CSV, JSON/JSONL, YAML, XML, PDF and DOCX, up to 8 MB per file.</p></div>
          <label className="primary-btn"><Upload size={14}/> {working ? "Processing…" : "Choose file"}
            <input type="file" multiple accept=".txt,.md,.mdx,.csv,.json,.jsonl,.ndjson,.log,.yaml,.yml,.xml,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.cs,.rb,.php,.sh,.ps1,.sql,.toml,.ini,.conf,.properties,.pdf,.docx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={working} onChange={e => { void importFiles(e.currentTarget.files); e.currentTarget.value = ""; }}/>
          </label>
        </div>
        {isTauri() && <div className="knowledge-import knowledge-workspace-import">
          <div><strong><FileText size={15}/> Import from approved workspace</strong><p>Indexes up to 100 supported text files (50 MB) from a folder already approved in NEXUS File System. Binary files are skipped.</p></div>
          {workspaceRoots.length > 0 ? <>
            <select aria-label="Approved workspace folder" value={selectedWorkspaceRoot} disabled={working} onChange={event => setSelectedWorkspaceRoot(event.target.value)}>
              {workspaceRoots.map(path => <option key={path} value={path}>{path}</option>)}
            </select>
            <button className="secondary-btn" disabled={working || !selectedWorkspaceRoot || !projectId} onClick={() => void importApprovedWorkspaceFolder()}>Scan and import folder</button>
          </> : <p>No approved folders yet. Grant access in NEXUS File System, then reopen this panel.</p>}
        </div>}
        <div className="knowledge-search">
          <label>Search project knowledge</label>
          <div><input aria-label="Search project knowledge" value={query} disabled={working} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void searchKnowledge(); }} placeholder="e.g. What are the core architecture decisions?"/>
          <button className="primary-btn" disabled={!query.trim() || working} onClick={() => void searchKnowledge()}><Search size={14}/> Search</button></div>
        </div>
      </>}
      {documents.length > 0 && <div className="knowledge-documents">
        <div className="knowledge-documents-heading"><strong>Project documents</strong><span>{documents.length} files</span><button className="secondary-btn" disabled={working || !projectId} onClick={() => void rebuildSemanticIndex()}>Repair semantic index</button></div>
        {documents.map(document => <div className="knowledge-document" key={document.documentId}>
          <div><FileText size={14}/><span><strong>{document.fileName}</strong><small>{document.chunkCount} chunks · {document.characterCount.toLocaleString()} characters</small></span></div>
          <button className="icon-btn" disabled={working} onClick={() => void removeDocument(document.documentId)} aria-label={"Remove " + document.fileName}><Trash2 size={14}/></button>
        </div>)}
      </div>}
      {status && <div className="knowledge-status">{status}</div>}
      {error && <div className="error-banner">{error}</div>}
      {answer && <div className="knowledge-results"><h3>Retrieved context</h3><pre>{answer}</pre>{citations.length > 0 && <div className="knowledge-citations"><strong>Sources</strong>{citations.map(c => <div key={c.chunkId}>{c.sourceLabel}{c.page ? ` · page ${c.page}` : ""}{c.section ? ` · ${c.section}` : ""}</div>)}</div>}</div>}
      <footer className="project-footnote">Stored in the desktop SQLite database (browser preview uses local storage). Imports support TXT, Markdown, source code, CSV, JSON/JSONL, YAML, XML, PDF, and DOCX. Local semantic search uses a sentence-transformer model downloaded on first use; lexical search remains available if it cannot load.</footer>
    </section>
  </div>;
}
