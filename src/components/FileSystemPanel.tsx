import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./file-system.css";
import { ArrowLeft, File, FileCode2, FileText, Folder, FolderOpen, FolderPlus, HardDrive, LockKeyhole, RefreshCw, Save, Search, ShieldCheck, X } from "lucide-react";

type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "directory" | "file" | "other";
  sizeBytes: number;
  modifiedAtMs: number | null;
};

type WorkspaceContentMatch = { path: string; lineNumber: number; preview: string };
type WorkspaceContentSearch = { matches: WorkspaceContentMatch[]; totalMatches: number; scannedFiles: number; truncated: boolean };

const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const joinPath = (base: string, name: string) => `${base.replace(/[\\/]+$/, "")}${base.includes("\\") ? "\\" : "/"}${name}`;
const parentPath = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index > 1 ? trimmed.slice(0, index) : trimmed.slice(0, Math.max(index + 1, 1));
};
const fileIcon = (name: string) => {
  const extension = name.split(".").pop()?.toLowerCase();
  return ["ts", "tsx", "js", "jsx", "rs", "py", "json", "css", "html", "yml", "yaml"].includes(extension ?? "") ? FileCode2 : FileText;
};

export function FileSystemPanel({ onClose, onAnalyze }: { onClose: () => void; onAnalyze?: (file: { name: string; path: string; content: string }) => void }) {
  const [roots, setRoots] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [preview, setPreview] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [grantPath, setGrantPath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [contentSearchMode, setContentSearchMode] = useState(false);
  const [contentMatches, setContentMatches] = useState<WorkspaceContentMatch[]>([]);
  const [contentSearchSummary, setContentSearchSummary] = useState("");
  const [newName, setNewName] = useState("");
  const [renameName, setRenameName] = useState("");
  const [moveDestination, setMoveDestination] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(path = currentPath) {
    if (!path || !isTauri()) return;
    setBusy(true);
    try {
      const result = await invoke<WorkspaceEntry[]>("list_workspace_entries", { path });
      setEntries(result);
      setCurrentPath(path);
      setSearchActive(false);
      setContentMatches([]);
      setContentSearchSummary("");
      setError("");
      if (selectedPath && !result.some(entry => entry.path === selectedPath)) {
        setSelectedPath("");
        setPreview("");
        setDraft("");
        setEditing(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function loadRoots() {
    if (!isTauri()) return;
    setBusy(true);
    try {
      const allowed = await invoke<string[]>("list_workspace_directories");
      setRoots(allowed);
      if (allowed.length && !currentPath) await refresh(allowed[0]);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadRoots(); }, []);

  async function searchFiles() {
    const query = searchQuery.trim();
    if (!currentPath || !query) return;
    setBusy(true);
    setError("");
    setSelectedPath("");
    setPreview("");
    setDraft("");
    setEditing(false);
    try {
      if (contentSearchMode) {
        const result = await invoke<WorkspaceContentSearch>("search_workspace_contents", { path: currentPath, query });
        setContentMatches(result.matches);
        setContentSearchSummary(`${result.totalMatches} matches in ${result.scannedFiles} files${result.truncated ? " · search limit reached" : ""}`);
        setEntries([]);
      } else {
        const result = await invoke<WorkspaceEntry[]>("search_workspace_entries", { path: currentPath, query });
        setEntries(result);
        setContentMatches([]);
        setContentSearchSummary("");
      }
      setSearchActive(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function chooseDirectory() {
    setError("");
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choose a folder NEXUS may access"
      });
      if (typeof selected === "string") setGrantPath(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the native folder picker.");
    }
  }

  async function grantDirectory() {
    if (!grantPath.trim()) return;
    setBusy(true);
    try {
      const allowed = await invoke<string[]>("grant_workspace_directory", { path: grantPath.trim() });
      setRoots(allowed);
      setGrantPath("");
      setNotice("Directory access granted. NEXUS can now browse and edit files inside this directory.");
      const granted = allowed.find(root => root.toLocaleLowerCase() === grantPath.trim().toLocaleLowerCase()) ?? allowed[0];
      if (granted) await refresh(granted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openEntry(entry: WorkspaceEntry) {
    if (entry.kind === "directory") {
      setSelectedPath("");
      setPreview("");
      setDraft("");
      setEditing(false);
      await refresh(entry.path);
      return;
    }
    if (entry.kind !== "file") return;
    setBusy(true);
    setError("");
    try {
      const content = await invoke<string>("read_workspace_file", { path: entry.path });
      setSelectedPath(entry.path);
      setRenameName(entry.name);
      setMoveDestination("");
      setPreview(content);
      setDraft(content);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveFile() {
    if (!selectedPath) return;
    setBusy(true);
    setError("");
    try {
      await invoke("write_workspace_file", { path: selectedPath, content: draft });
      setPreview(draft);
      setEditing(false);
      setNotice("File saved.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function renameSelected() {
    if (!selectedPath || !renameName.trim()) return;
    if (!window.confirm(`Rename this file to "${renameName.trim()}"? The file contents will not change.`)) return;
    setBusy(true);
    setError("");
    try {
      const nextPath = await invoke<string>("rename_workspace_entry", { path: selectedPath, newName: renameName.trim() });
      const content = await invoke<string>("read_workspace_file", { path: nextPath });
      await refresh();
      setSelectedPath(nextPath);
      setRenameName(nextPath.split(/[\\\\/]/).pop() ?? renameName.trim());
      setPreview(content);
      setDraft(content);
      setEditing(false);
      setNotice("File renamed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function chooseMoveDestination() {
    setError("");
    try {
      const selected = await open({ directory: true, multiple: false, title: "Choose a destination inside the same approved folder" });
      if (typeof selected === "string") setMoveDestination(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not choose a destination folder.");
    }
  }

  async function moveSelected() {
    if (!selectedPath || !moveDestination.trim()) return;
    if (!window.confirm(`Move this file to the selected folder?\\n\\n${moveDestination.trim()}`)) return;
    setBusy(true);
    setError("");
    try {
      await invoke<string>("move_workspace_entry", { path: selectedPath, destinationDirectory: moveDestination.trim() });
      setSelectedPath("");
      setPreview("");
      setDraft("");
      setEditing(false);
      setNotice("File moved.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function createEntry(kind: "file" | "directory") {
    const name = newName.trim();
    if (!name || !currentPath || name === "." || name === ".." || /[\\/]/.test(name)) {
      setError("Enter a valid name without path separators.");
      return;
    }
    const path = joinPath(currentPath, name);
    setBusy(true);
    setError("");
    try {
      if (kind === "directory") await invoke("create_workspace_directory", { path });
      else await invoke("write_workspace_file", { path, content: "" });
      setNewName("");
      setNotice(kind === "directory" ? "Folder created." : "File created.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revokeDirectory(path: string) {
    if (!window.confirm(`Remove NEXUS access to this directory? Existing files will not be changed.\n\n${path}`)) return;
    setBusy(true);
    try {
      const allowed = await invoke<string[]>("revoke_workspace_directory", { path });
      setRoots(allowed);
      setCurrentPath(allowed[0] ?? "");
      setEntries([]);
      setSelectedPath("");
      setPreview("");
      setDraft("");
      setEditing(false);
      if (allowed[0]) await refresh(allowed[0]);
      setNotice("Directory access revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const SelectedIcon = selectedPath ? fileIcon(selectedPath) : File;
  const isAllowedCurrent = roots.some(root => currentPath === root || currentPath.startsWith(root.replace(/[\\/]+$/, "") + (root.includes("\\") ? "\\" : "/")));

  return <div className="modal-backdrop file-workspace-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="file-workspace" role="dialog" aria-modal="true" aria-labelledby="file-workspace-title">
      <header className="file-workspace-header">
        <div className="file-workspace-heading"><div className="file-workspace-mark"><HardDrive size={19}/></div><div><div className="eyebrow">NATIVE WORKSPACE MODULE</div><h2 id="file-workspace-title">File system</h2><p>Browse, search, create, edit, rename, and move files in approved folders</p></div></div>
        <div className="file-workspace-header-actions"><span className="file-preview-state"><i/> {isTauri() ? "NATIVE ACCESS" : "DESKTOP REQUIRED"}</span><button className="icon-btn" onClick={onClose} aria-label="Close file system"><X size={18}/></button></div>
      </header>
      {!isTauri() ? <div className="file-workspace-empty"><LockKeyhole size={28}/><h3>Native desktop access required</h3><p>Windows folders are accessed by the Tauri desktop app, not the browser preview.</p></div> : <>
        <div className="file-workspace-toolbar">
          <div className="file-search"><HardDrive size={15}/><span>{currentPath || "No folder selected"}</span></div>
          <button className="secondary-btn" onClick={() => void refresh()} disabled={!currentPath || busy}><RefreshCw size={14}/> Refresh</button>
          <button className="secondary-btn" onClick={() => void refresh(parentPath(currentPath))} disabled={!isAllowedCurrent || currentPath === roots.find(root => root === currentPath) || busy}><ArrowLeft size={14}/> Up</button>
        </div>
        <div className="file-search-toolbar">
          <div className="file-search-mode" role="group" aria-label="Search mode">
            <button className="secondary-btn" aria-pressed={!contentSearchMode} onClick={() => { setContentSearchMode(false); setContentMatches([]); setContentSearchSummary(""); }} disabled={busy}>Names</button>
            <button className="secondary-btn" aria-pressed={contentSearchMode} onClick={() => { setContentSearchMode(true); setEntries([]); }} disabled={busy}>Text content</button>
          </div>
          <label className="file-search-input"><Search size={14}/><input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void searchFiles(); }} placeholder={contentSearchMode ? "Find text inside files (max 500 files)" : "Search names in this folder and subfolders"} aria-label="Search approved folders"/></label>
          <button className="secondary-btn" onClick={() => void searchFiles()} disabled={busy || !currentPath || !searchQuery.trim()}><Search size={13}/> Search</button>
          {searchActive && <button className="secondary-btn" onClick={() => { setSearchQuery(""); void refresh(); }} disabled={busy}>Clear</button>}
        </div>
        <div className="file-access-grant">
          <div className="file-pane-label">APPROVED DIRECTORIES</div>
          <div className="file-grant-input"><input value={grantPath} onChange={event => setGrantPath(event.target.value)} placeholder="Choose a folder or enter its path" aria-label="Folder path to grant"/><button className="secondary-btn" onClick={() => void chooseDirectory()} disabled={busy}><FolderOpen size={14}/> Browse</button><button className="primary-btn" onClick={() => void grantDirectory()} disabled={busy || !grantPath.trim()}>Allow folder</button></div>
          {roots.map(root => <div className="file-root-row" key={root}><button onClick={() => void refresh(root)}><Folder size={14}/><span>{root}</span></button><button className="file-revoke" onClick={() => void revokeDirectory(root)} disabled={busy}>Revoke</button></div>)}
          {!roots.length && <p>No directories have been approved. Add one above. Access is limited to the exact folders you approve.</p>}
        </div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {notice && <div className="knowledge-status" role="status">{notice}</div>}
        <div className="file-workspace-body">
          <div className="file-list-pane">
            <div className="file-pane-heading"><div><span className="file-pane-label">{searchActive ? "SEARCH RESULTS" : "CURRENT LOCATION"}</span><strong>{currentPath || "Choose an approved folder"}</strong>{contentSearchMode && searchActive && contentSearchSummary && <small className="file-search-summary">{contentSearchSummary}</small>}</div><span>{contentSearchMode && searchActive ? contentMatches.length : entries.length} items</span></div>
            <div className="file-table-head"><span>NAME</span><span>SIZE</span><span>MODIFIED</span></div>
            <div className="file-list" role="list" aria-label="Workspace files">
              {contentSearchMode && searchActive ? contentMatches.map((match, index) => {
                const name = match.path.split(/[\\/]/).pop() ?? match.path;
                return <button key={`${match.path}:${match.lineNumber}:${index}`} className={selectedPath === match.path ? "selected" : ""} onClick={() => void openEntry({ name, path: match.path, kind: "file", sizeBytes: 0, modifiedAtMs: null })}>
                  <span className="file-name"><FileText size={16}/><span><strong>{name}</strong><small>{match.path} · line {match.lineNumber}</small><small className="file-content-match-preview">{match.preview}</small></span></span><span>Line {match.lineNumber}</span><span>—</span>
                </button>;
              }) : entries.map(entry => { const EntryIcon = entry.kind === "directory" ? Folder : fileIcon(entry.name); return <button key={entry.path} className={selectedPath === entry.path ? "selected" : ""} aria-pressed={selectedPath === entry.path} onClick={() => void openEntry(entry)}><span className="file-name"><EntryIcon size={16}/><span><strong>{entry.name}</strong><small>{entry.kind}</small></span></span><span>{entry.kind === "file" ? formatSize(entry.sizeBytes) : "—"}</span><span>{entry.modifiedAtMs ? new Date(Number(entry.modifiedAtMs)).toLocaleDateString() : "—"}</span></button>; })}
              {!(contentSearchMode && searchActive ? contentMatches.length : entries.length) && <div className="file-empty">{busy ? "Loading..." : searchActive ? contentSearchMode ? "No matching text was found in the scanned files." : "No matching file or folder names were found." : "This folder is empty or not selected."}</div>}
            </div>
            {currentPath && <div className="file-create-row"><input value={newName} onChange={event => setNewName(event.target.value)} placeholder="New file or folder name"/><button className="secondary-btn" onClick={() => void createEntry("file")} disabled={busy || !newName.trim()}><File size={14}/> New file</button><button className="secondary-btn" onClick={() => void createEntry("directory")} disabled={busy || !newName.trim()}><FolderPlus size={14}/> New folder</button></div>}
          </div>
          <aside className="file-preview-pane">
            <div className="file-pane-label">INSPECTOR</div>
            {selectedPath ? <><div className="file-preview-icon"><SelectedIcon size={24}/></div><h3>{selectedPath.split(/[\\/]/).pop()}</h3><p>{selectedPath}</p><div className="file-entry-actions">
              <label>Rename file<input aria-label="New file name" value={renameName} onChange={event => setRenameName(event.target.value)} /></label>
              <button className="secondary-btn" onClick={() => void renameSelected()} disabled={busy || !renameName.trim()}>Rename</button>
              <label>Move to approved folder<div className="file-move-input"><input aria-label="Move destination folder" value={moveDestination} onChange={event => setMoveDestination(event.target.value)} placeholder="Destination folder path"/><button className="secondary-btn" onClick={() => void chooseMoveDestination()} disabled={busy}>Browse</button></div></label>
              <button className="secondary-btn" onClick={() => void moveSelected()} disabled={busy || !moveDestination.trim()}>Move file</button>
            </div><div className="file-preview-content"><div className="file-pane-label">TEXT CONTENT · MAX 2 MB</div>{editing ? <textarea className="file-editor" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false}/> : <pre>{preview}</pre>}</div><div className="file-editor-actions">{editing ? <><button className="primary-btn" onClick={() => void saveFile()} disabled={busy}><Save size={14}/> Save changes</button><button className="secondary-btn" onClick={() => { setDraft(preview); setEditing(false); }}>Cancel</button></> : <><button className="secondary-btn" onClick={() => setEditing(true)}>Edit file</button>{onAnalyze && <button className="primary-btn" onClick={() => onAnalyze({ name: selectedPath.split(/[\\\\/]/).pop() ?? selectedPath, path: selectedPath, content: preview })} disabled={busy}>Analyze with AI</button>}</>}</div></> : <div className="file-empty">Select a text file to inspect or edit it.</div>}
          </aside>
        </div>
        <footer className="file-workspace-footer"><span><ShieldCheck size={15}/> Permission-scoped access · External folders are not accessed without approval</span><button className="secondary-btn" onClick={onClose}>Close workspace</button></footer>
      </>}
    </section>
  </div>;
}
