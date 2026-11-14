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
type WorkspaceImagePreview = { dataUrl: string; mediaType: string; sizeBytes: number };

const isRasterImage = (name: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(name);

const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B`
  : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const joinPath = (base: string, name: string) => `${base.replace(/[\\/]+$/, "")}${base.includes("\\") ? "\\" : "/"}${name}`;
const parentPath = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index > 1 ? trimmed.slice(0, index) : trimmed.slice(0, Math.max(index + 1, 1));
};
async function recordFilesystemAudit(action: string): Promise<boolean> {
  try {
    await invoke("record_tool_audit_event", {
      event: { toolId: `filesystem.${action}`, runId: "filesystem-owner-ui", traceId: crypto.randomUUID(), status: "completed", timestamp: Date.now() }
    });
    return true;
  } catch {
    return false;
  }
}

const fileIcon = (name: string) => {
  const extension = name.split(".").pop()?.toLowerCase();
  return ["ts", "tsx", "js", "jsx", "rs", "py", "json", "css", "html", "yml", "yaml"].includes(extension ?? "") ? FileCode2 : FileText;
};

export function FileSystemPanel({ onClose, onAnalyze }: { onClose: () => void; onAnalyze?: (file: { name: string; path: string; content: string }) => void }) {
  const [roots, setRoots] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [renamePrefix, setRenamePrefix] = useState("");
  const [renameSuffix, setRenameSuffix] = useState("");
  const [preview, setPreview] = useState("");
  const [imagePreview, setImagePreview] = useState<WorkspaceImagePreview | null>(null);
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
  const [conflictDetected, setConflictDetected] = useState(false);
  const [busy, setBusy] = useState(false);

  function confirmDiscardDraft(action: string): boolean {
    if (!editing || draft === preview) return true;
    return window.confirm(`You have unsaved file edits. Discard them and ${action}?`);
  }

  function closeWorkspace() {
    if (confirmDiscardDraft("close the File System")) onClose();
  }

  useEffect(() => {
    const requestClose = () => closeWorkspace();
    window.addEventListener("nexus-file-system-close-request", requestClose);
    return () => window.removeEventListener("nexus-file-system-close-request", requestClose);
  }, [editing, draft, preview, onClose]);

  async function refresh(path = currentPath, discardConfirmed = false) {
    if (!path || !isTauri()) return;
    if (!discardConfirmed && !confirmDiscardDraft("refresh or navigate the file list")) return;
    setBusy(true);
    try {
      const result = await invoke<WorkspaceEntry[]>("list_workspace_entries", { path });
      setEntries(result);
      setSelectedPaths(previous => previous.filter(selected => result.some(entry => entry.path === selected && entry.kind === "file")));
      setCurrentPath(path);
      setSearchActive(false);
      setContentMatches([]);
      setContentSearchSummary("");
      setError("");
      if (selectedPath && !result.some(entry => entry.path === selectedPath)) {
        setSelectedPath("");
        setPreview("");
        setImagePreview(null);
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
    if (!confirmDiscardDraft("search files")) return;
    setBusy(true);
    setError("");
    setSelectedPath("");
    setSelectedPaths([]);
    setPreview("");
    setImagePreview(null);
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
      if (contentSearchMode) await recordFilesystemAudit("search_content");
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
      const audited = await recordFilesystemAudit("access_grant");
      setRoots(allowed);
      setGrantPath("");
      setNotice(audited ? "Directory access granted. NEXUS can now browse and edit files inside this directory." : "Directory access was granted, but the audit entry could not be saved.");
      const granted = allowed.find(root => root.toLocaleLowerCase() === grantPath.trim().toLocaleLowerCase()) ?? allowed[0];
      if (granted) await refresh(granted);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openEntry(entry: WorkspaceEntry) {
    if (!confirmDiscardDraft("open another file or folder")) return;
    if (entry.kind === "directory") {
      setSelectedPath("");
      setPreview("");
      setImagePreview(null);
      setDraft("");
      setEditing(false);
      await refresh(entry.path, true);
      return;
    }
    if (entry.kind !== "file") return;
    setBusy(true);
    setError("");
    try {
      setMoveDestination("");
      setEditing(false);
      if (isRasterImage(entry.name)) {
        const image = await invoke<WorkspaceImagePreview>("read_workspace_image_preview", { path: entry.path });
        setSelectedPath(entry.path);
        setRenameName(entry.name);
        setConflictDetected(false);
        setImagePreview(image);
        setPreview("");
        setDraft("");
        const audited = await recordFilesystemAudit("read_image_preview");
        if (!audited) setNotice("Image preview loaded, but the audit entry could not be saved.");
      } else {
        const content = await invoke<string>("read_workspace_file", { path: entry.path });
        setSelectedPath(entry.path);
        setRenameName(entry.name);
        setConflictDetected(false);
        setImagePreview(null);
        setPreview(content);
        setDraft(content);
        const audited = await recordFilesystemAudit("read");
        if (!audited) setNotice("File opened, but the audit entry could not be saved.");
      }
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
      await invoke("write_workspace_file_checked", { path: selectedPath, content: draft, expectedContent: preview });
      const audited = await recordFilesystemAudit("write");
      setPreview(draft);
      setEditing(false);
      setConflictDetected(false);
      setNotice(audited ? "File saved." : "File saved, but the audit entry could not be saved.");
      await refresh(currentPath, true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setConflictDetected(/changed|removed or moved/i.test(message));
    } finally {
      setBusy(false);
    }
  }

  async function reloadLatestFile() {
    if (!selectedPath || !conflictDetected) return;
    if (!window.confirm("Reload the latest file version? Your unsaved draft will be replaced.")) return;
    setBusy(true);
    try {
      const latest = await invoke<string>("read_workspace_file", { path: selectedPath });
      setImagePreview(null);
      setPreview(latest);
      setDraft(latest);
      setEditing(false);
      setConflictDetected(false);
      setError("");
      setNotice("Latest file version loaded. Review it before making further edits.");
      await recordFilesystemAudit("read");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function renameSelected() {
    if (!selectedPath || !renameName.trim() || !confirmDiscardDraft("rename this file")) return;
    if (!window.confirm(`Rename this file to "${renameName.trim()}"? The file contents will not change.`)) return;
    setBusy(true);
    setError("");
    try {
      const nextPath = await invoke<string>("rename_workspace_entry", { path: selectedPath, newName: renameName.trim() });
      const audited = await recordFilesystemAudit("rename");
      const content = await invoke<string>("read_workspace_file", { path: nextPath });
      await refresh(currentPath, true);
      setSelectedPath(nextPath);
      setRenameName(nextPath.split(/[\\\\/]/).pop() ?? renameName.trim());
      setImagePreview(null);
      setPreview(content);
      setDraft(content);
      setEditing(false);
      setNotice(audited ? "File renamed." : "File renamed, but the audit entry could not be saved.");
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
    if (!selectedPath || !moveDestination.trim() || !confirmDiscardDraft("move this file")) return;
    if (!window.confirm(`Move this file to the selected folder?\n\n${moveDestination.trim()}`)) return;
    setBusy(true);
    setError("");
    try {
      await invoke<string>("move_workspace_entry", { path: selectedPath, destinationDirectory: moveDestination.trim() });
      const audited = await recordFilesystemAudit("move");
      setSelectedPath("");
      setPreview("");
      setImagePreview(null);
      setDraft("");
      setEditing(false);
      setNotice(audited ? "File moved." : "File moved, but the audit entry could not be saved.");
      await refresh(currentPath, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function bulkMoveSelected() {
    if (!selectedPaths.length || !confirmDiscardDraft("move the selected files")) return;
    let destination: string | string[] | null;
    try {
      destination = await open({ directory: true, multiple: false, title: "Choose destination folder" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    if (typeof destination !== "string") return;
    if (!window.confirm("Move " + selectedPaths.length + " selected files to this approved folder? Existing files will not be overwritten. If a move fails, NEXUS will try to restore files already moved.\n\n" + destination)) return;

    setBusy(true);
    setError("");
    setNotice("");
    const moved: Array<{ destination: string; originalDirectory: string }> = [];
    let auditFailures = 0;
    try {
      for (const source of selectedPaths) {
        const movedPath = await invoke<string>("move_workspace_entry", { path: source, destinationDirectory: destination });
        moved.push({ destination: movedPath, originalDirectory: parentPath(source) });
        if (!(await recordFilesystemAudit("move"))) auditFailures += 1;
      }
      setSelectedPaths([]);
      setNotice("Moved " + moved.length + " files." + (auditFailures ? " " + auditFailures + " audit entr" + (auditFailures === 1 ? "y could" : "ies could") + " not be saved." : ""));
      await refresh(currentPath, true);
    } catch (cause) {
      const rollbackFailures: string[] = [];
      for (const item of [...moved].reverse()) {
        try {
          await invoke<string>("move_workspace_entry", { path: item.destination, destinationDirectory: item.originalDirectory });
          if (!(await recordFilesystemAudit("move"))) auditFailures += 1;
        } catch {
          rollbackFailures.push(item.destination);
        }
      }
      const failureMessage = rollbackFailures.length
        ? "Bulk move stopped and rollback was incomplete. " + rollbackFailures.length + " file(s) need manual review: " + rollbackFailures.slice(0, 4).join(", ")
        : "Bulk move failed; previously moved files were restored. " + (cause instanceof Error ? cause.message : String(cause));
      if (rollbackFailures.length) setSelectedPaths([]);
      await refresh(currentPath, true);
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  }

  async function bulkRenameSelected() {
    if (!selectedPaths.length || !confirmDiscardDraft("rename the selected files")) return;
    const prefix = renamePrefix;
    const suffix = renameSuffix;
    if (!prefix.trim() && !suffix.trim()) {
      setError("Enter a prefix or suffix before renaming files.");
      return;
    }
    const entriesToRename = selectedPaths.map(path => {
      const name = path.split(/[\\\\/]/).pop() ?? path;
      const extensionIndex = name.lastIndexOf(".");
      const hasExtension = extensionIndex > 0;
      const stem = hasExtension ? name.slice(0, extensionIndex) : name;
      const extension = hasExtension ? name.slice(extensionIndex) : "";
      return { path, newName: prefix + stem + suffix + extension };
    });
    const targets = entriesToRename.map(entry => entry.newName.toLowerCase());
    if (new Set(targets).size !== targets.length) {
      setError("The rename pattern creates duplicate file names. Change the prefix or suffix.");
      return;
    }
    if (entriesToRename.some(entry => !entry.newName.trim() || entry.newName.length > 255)) {
      setError("The generated file names must contain 1 to 255 characters.");
      return;
    }
    const previewNames = entriesToRename.slice(0, 8).map(entry => entry.newName).join("\n");
    const omittedCount = entriesToRename.length - Math.min(entriesToRename.length, 8);
    const omittedNote = omittedCount > 0 ? "\n… and " + omittedCount + " more file(s)" : "";
    if (!window.confirm("Rename " + entriesToRename.length + " selected files? File extensions are preserved. Existing files will not be overwritten. If a rename fails, NEXUS will try to restore earlier names.\n\n" + previewNames + omittedNote)) return;

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const renamedPaths = await invoke<string[]>("rename_workspace_entries_batch", { entries: entriesToRename });
      let auditFailures = 0;
      for (const _entry of entriesToRename) {
        if (!(await recordFilesystemAudit("rename"))) auditFailures += 1;
      }
      if (selectedPath) {
        const selectedIndex = entriesToRename.findIndex(entry => entry.path === selectedPath);
        if (selectedIndex >= 0) {
          setSelectedPath(renamedPaths[selectedIndex] ?? "");
          setRenameName(entriesToRename[selectedIndex].newName);
        }
      }
      setSelectedPaths([]);
      setRenamePrefix("");
      setRenameSuffix("");
      setNotice("Renamed " + renamedPaths.length + " files." + (auditFailures ? " " + auditFailures + " audit entr" + (auditFailures === 1 ? "y could" : "ies could") + " not be saved." : ""));
      await refresh(currentPath, true);
    } catch (cause) {
      const failureMessage = cause instanceof Error ? cause.message : String(cause);
      await refresh(currentPath, true);
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  }

  async function createEntry(kind: "file" | "directory") {
    if (!confirmDiscardDraft("create a new entry and refresh the file list")) return;
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
      const audited = await recordFilesystemAudit(kind === "directory" ? "create_directory" : "create_file");
      setNewName("");
      setNotice(audited ? (kind === "directory" ? "Folder created." : "File created.") : (kind === "directory" ? "Folder created, but the audit entry could not be saved." : "File created, but the audit entry could not be saved."));
      await refresh(currentPath, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revokeDirectory(path: string) {
    if (!confirmDiscardDraft("revoke this directory") || !window.confirm(`Remove NEXUS access to this directory? Existing files will not be changed.\n\n${path}`)) return;
    setBusy(true);
    try {
      const allowed = await invoke<string[]>("revoke_workspace_directory", { path });
      const audited = await recordFilesystemAudit("access_revoke");
      setRoots(allowed);
      setCurrentPath(allowed[0] ?? "");
      setEntries([]);
      setSelectedPath("");
      setPreview("");
      setImagePreview(null);
      setDraft("");
      setEditing(false);
      if (allowed[0]) await refresh(allowed[0], true);
      setNotice(audited ? "Directory access revoked." : "Directory access was revoked, but the audit entry could not be saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const SelectedIcon = selectedPath ? fileIcon(selectedPath) : File;
  const isAllowedCurrent = roots.some(root => currentPath === root || currentPath.startsWith(root.replace(/[\\/]+$/, "") + (root.includes("\\") ? "\\" : "/")));

  return <div className="modal-backdrop file-workspace-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeWorkspace(); }}>
    <section className="file-workspace" role="dialog" aria-modal="true" aria-labelledby="file-workspace-title">
      <header className="file-workspace-header">
        <div className="file-workspace-heading"><div className="file-workspace-mark"><HardDrive size={19}/></div><div><div className="eyebrow">NATIVE WORKSPACE MODULE</div><h2 id="file-workspace-title">File system</h2><p>Browse, search, create, edit, rename, and move files in approved folders</p></div></div>
        <div className="file-workspace-header-actions"><span className="file-preview-state"><i/> {isTauri() ? "NATIVE ACCESS" : "DESKTOP REQUIRED"}</span><button className="icon-btn" onClick={closeWorkspace} aria-label="Close file system"><X size={18}/></button></div>
      </header>
      {!isTauri() ? <div className="file-workspace-empty"><LockKeyhole size={28}/><h3>Native desktop access required</h3><p>Windows folders are accessed by the Tauri desktop app, not the browser preview.</p></div> : <>
        <div className="file-workspace-toolbar">
          <div className="file-search"><HardDrive size={15}/><span>{currentPath || "No folder selected"}</span></div>
          <button className="secondary-btn" onClick={() => void refresh()} disabled={!currentPath || busy}><RefreshCw size={14}/> Refresh</button>
          <button className="secondary-btn" onClick={() => { if (confirmDiscardDraft("navigate to the parent folder")) void refresh(parentPath(currentPath), true); }} disabled={!isAllowedCurrent || currentPath === roots.find(root => root === currentPath) || busy}><ArrowLeft size={14}/> Up</button>
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
          {roots.map(root => <div className="file-root-row" key={root}><button onClick={() => { if (confirmDiscardDraft("open another approved folder")) void refresh(root, true); }}><Folder size={14}/><span>{root}</span></button><button className="file-revoke" onClick={() => void revokeDirectory(root)} disabled={busy}>Revoke</button></div>)}
          {!roots.length && <p>No directories have been approved. Add one above. Access is limited to the exact folders you approve.</p>}
        </div>
        {error && <div className="error-banner" role="alert">{error}{conflictDetected && <button className="secondary-btn" onClick={() => void reloadLatestFile()} disabled={busy}>Reload latest version</button>}</div>}
        {notice && <div className="knowledge-status" role="status">{notice}</div>}
        <div className="file-workspace-body">
          <div className="file-list-pane">
            <div className="file-pane-heading"><div><span className="file-pane-label">{searchActive ? "SEARCH RESULTS" : "CURRENT LOCATION"}</span><strong>{currentPath || "Choose an approved folder"}</strong>{contentSearchMode && searchActive && contentSearchSummary && <small className="file-search-summary">{contentSearchSummary}</small>}</div><span>{contentSearchMode && searchActive ? contentMatches.length : entries.length} items</span></div>
            <div className="file-table-head"><span>NAME</span><span>SIZE</span><span>MODIFIED</span></div>
            {selectedPaths.length > 0 && <div className="file-bulk-actions"><span>{selectedPaths.length} of 100 files selected</span><input aria-label="Bulk rename prefix" value={renamePrefix} onChange={event => setRenamePrefix(event.target.value)} placeholder="Prefix"/><input aria-label="Bulk rename suffix" value={renameSuffix} onChange={event => setRenameSuffix(event.target.value)} placeholder="Suffix"/><button className="secondary-btn" onClick={() => void bulkRenameSelected()} disabled={busy || (!renamePrefix && !renameSuffix)}>Rename selected</button><button className="secondary-btn" onClick={() => void bulkMoveSelected()} disabled={busy}>Move selected</button><button className="secondary-btn" onClick={() => setSelectedPaths([])} disabled={busy}>Clear</button></div>}
            <div className="file-list" role="list" aria-label="Workspace files">
              {contentSearchMode && searchActive ? contentMatches.map((match, index) => {
                const name = match.path.split(/[\\/]/).pop() ?? match.path;
                return <button key={`${match.path}:${match.lineNumber}:${index}`} className={selectedPath === match.path ? "selected" : ""} onClick={() => void openEntry({ name, path: match.path, kind: "file", sizeBytes: 0, modifiedAtMs: null })}>
                  <span className="file-name"><FileText size={16}/><span><strong>{name}</strong><small>{match.path} · line {match.lineNumber}</small><small className="file-content-match-preview">{match.preview}</small></span></span><span>Line {match.lineNumber}</span><span>—</span>
                </button>;
              }) : entries.map(entry => { const EntryIcon = entry.kind === "directory" ? Folder : fileIcon(entry.name); return <div key={entry.path} className="file-list-row" role="listitem"><button className={selectedPath === entry.path ? "selected" : ""} aria-pressed={selectedPath === entry.path} onClick={() => void openEntry(entry)}><span className="file-name"><EntryIcon size={16}/><span><strong>{entry.name}</strong><small>{entry.kind}</small></span></span><span>{entry.kind === "file" ? formatSize(entry.sizeBytes) : "—"}</span><span>{entry.modifiedAtMs ? new Date(Number(entry.modifiedAtMs)).toLocaleDateString() : "—"}</span></button>{entry.kind === "file" && <input type="checkbox" aria-label={"Select " + entry.name + " for bulk move"} checked={selectedPaths.includes(entry.path)} disabled={busy || (selectedPaths.length >= 100 && !selectedPaths.includes(entry.path))} onChange={event => { const checked = event.currentTarget.checked; setSelectedPaths(current => checked ? [...current, entry.path] : current.filter(path => path !== entry.path)); }}/>}</div>; })}
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
            </div>{imagePreview ? <div className="file-preview-content"><div className="file-pane-label">IMAGE PREVIEW · READ ONLY · MAX 4 MB</div><div className="file-image-preview"><img src={imagePreview.dataUrl} alt={selectedPath.split(/[\\\\/]/).pop() ?? "Selected image"} /><small>{imagePreview.mediaType} · {formatSize(imagePreview.sizeBytes)}</small></div></div> : <div className="file-preview-content"><div className="file-pane-label">TEXT CONTENT · MAX 2 MB</div>{editing ? <textarea className="file-editor" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false}/> : <pre>{preview}</pre>}</div>}<div className="file-editor-actions">{editing ? <><button className="primary-btn" onClick={() => void saveFile()} disabled={busy}><Save size={14}/> Save changes</button><button className="secondary-btn" onClick={() => { setDraft(preview); setEditing(false); }}>Cancel</button></> : !imagePreview ? <><button className="secondary-btn" onClick={() => setEditing(true)}>Edit file</button>{onAnalyze && <button className="primary-btn" onClick={() => onAnalyze({ name: selectedPath.split(/[\\\\/]/).pop() ?? selectedPath, path: selectedPath, content: preview })} disabled={busy}>Analyze with AI</button>}</> : <span className="file-image-readonly">Image previews are read-only. Original file is unchanged.</span>}</div></> : <div className="file-empty">Select a text file to inspect or edit it.</div>}
          </aside>
        </div>
        <footer className="file-workspace-footer"><span><ShieldCheck size={15}/> Permission-scoped access · External folders are not accessed without approval</span><button className="secondary-btn" onClick={closeWorkspace}>Close workspace</button></footer>
      </>}
    </section>
  </div>;
}
