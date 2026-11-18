use serde::Serialize;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
#[cfg(windows)]
use cap_fs_ext::OpenOptionsMaybeDirExt;
use cap_std::fs::{Dir as CapabilityDir, OpenOptions as CapabilityOpenOptions};
#[cfg(windows)]
use cap_std::fs::OpenOptionsExt;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const MAX_ALLOWED_ROOTS: usize = 32;
const MAX_PERMISSION_FILE_BYTES: u64 = 1_048_576;
const MAX_DIRECTORY_ENTRIES: usize = 500;

const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

pub(crate) use nexus_workspace::ensure_no_external_hard_links;
use nexus_workspace::{is_capability_link_or_reparse, is_link_or_reparse, open_child_directory};

/// Opens only a regular file and refuses to follow a final-component symlink/reparse point.
/// The caller must still validate the canonical parent against an approved root.
pub(crate) fn open_regular_file_readonly(path: &Path) -> Result<fs::File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: open the reparse point itself, never its target.
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path)
        .map_err(|error| format!("Could not open a regular file without following links: {error}"))?;
    let metadata = file.metadata().map_err(|error| format!("Could not inspect the opened file: {error}"))?;
    if !metadata.is_file() || is_link_or_reparse(&metadata) {
        return Err("NEXUS can open regular files only, not links or special entries.".into());
    }
    ensure_no_external_hard_links(&file)?;
    Ok(file)
}

/// Opens an existing regular file for checked in-place editing without following
/// a final-component symlink or Windows reparse point.
fn open_regular_file_readwrite(path: &Path) -> Result<fs::File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000);
    }
    let file = options.open(path)
        .map_err(|error| format!("Could not open the approved file without following links: {error}"))?;
    let metadata = file.metadata()
        .map_err(|error| format!("Could not inspect the opened file safely: {error}"))?;
    if !metadata.is_file() || is_link_or_reparse(&metadata) {
        return Err("NEXUS can edit regular files only, not links or special entries.".into());
    }
    ensure_no_external_hard_links(&file)?;
    Ok(file)
}

fn create_workspace_permissions_temp(path: &Path) -> Result<(PathBuf, fs::File), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("workspace-permissions");
    for attempt in 0..16 {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let temporary = parent.join(format!(".{name}.tmp-{}-{nonce}-{attempt}", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        match options.open(&temporary) {
            Ok(file) => return Ok((temporary, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not write workspace permissions: {error}")),
        }
    }
    Err("Could not create a unique temporary workspace permissions file.".into())
}

fn open_approved_root_handle(root: &Path) -> Result<CapabilityDir, String> {
    let canonical = fs::canonicalize(root)
        .map_err(|error| format!("Could not verify the approved directory: {error}"))?;
    if canonical != root {
        return Err("The approved directory path changed and must be approved again.".into());
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_DIRECTORY);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Keep the directory pinned against rename/delete while allowing the
        // handle-relative no-replace rename API to add files and subdirectories.
        // These are narrowly scoped directory rights, not GENERIC_WRITE.
        options.access_mode(0x8000_0000 | 0x0000_0002 | 0x0000_0004);
        options.custom_flags(0x0020_0000 | 0x0200_0000);
        options.share_mode(0x0000_0001 | 0x0000_0002);
    }
    let file = options.open(root)
        .map_err(|error| format!("Could not pin the approved directory: {error}"))?;
    let metadata = file.metadata()
        .map_err(|error| format!("Could not inspect the approved directory handle: {error}"))?;
    if !metadata.is_dir() || is_link_or_reparse(&metadata) {
        return Err("The approved workspace root is no longer a regular directory.".into());
    }
    if fs::canonicalize(root).map_err(|error| error.to_string())? != root {
        return Err("The approved directory changed while NEXUS was opening it.".into());
    }
    Ok(CapabilityDir::from_std_file(file))
}

pub(crate) fn open_capability_file(
    directory: &CapabilityDir,
    name: &std::ffi::OsStr,
    read: bool,
    write: bool,
    create_new: bool,
) -> Result<fs::File, String> {
    let mut options = CapabilityOpenOptions::new();
    options.read(read).write(write).create_new(create_new).follow(FollowSymlinks::No);
    let file = directory.open_with(Path::new(name), &options)
        .map(cap_std::fs::File::into_std)
        .map_err(|error| format!("Could not safely open the approved file: {error}"))?;
    let metadata = file.metadata().map_err(|error| format!("Could not inspect the approved file: {error}"))?;
    if !metadata.is_file() || is_link_or_reparse(&metadata) {
        return Err("Only regular, non-reparse files can be opened.".into());
    }
    Ok(file)
}

pub struct WorkspaceAccess {
    roots: Mutex<Vec<PathBuf>>,
    persistence_path: PathBuf,
}

impl WorkspaceAccess {
    #[cfg(test)]
    pub(crate) fn for_test(roots: Vec<PathBuf>, persistence_path: PathBuf) -> Self {
        Self { roots: Mutex::new(roots), persistence_path }
    }

    pub fn load(persistence_path: PathBuf) -> Self {
        let persisted = open_regular_file_readonly(&persistence_path).ok()
            .and_then(|file| {
                if file.metadata().ok()?.len() > MAX_PERMISSION_FILE_BYTES {
                    return None;
                }
                let mut raw = String::new();
                file.take(MAX_PERMISSION_FILE_BYTES + 1).read_to_string(&mut raw).ok()?;
                if raw.len() as u64 > MAX_PERMISSION_FILE_BYTES {
                    return None;
                }
                serde_json::from_str::<Vec<String>>(&raw).ok()
            })
            .filter(|values| values.len() <= MAX_ALLOWED_ROOTS)
            .unwrap_or_default();
        let roots = persisted.into_iter()
            .filter(|value| !value.trim().is_empty() && value.len() <= 4096)
            .filter_map(|value| {
                let path = PathBuf::from(value);
                let canonical = fs::canonicalize(&path).ok()?;
                // Persisted grants contain canonical paths. If a directory or any
                // ancestor was replaced by a symlink/reparse point while NEXUS was
                // closed, do not silently retarget the owner's previous approval.
                if canonical != path {
                    return None;
                }
                let metadata = fs::symlink_metadata(&path).ok()?;
                if !metadata.is_dir() || is_link_or_reparse(&metadata) {
                    return None;
                }
                Some(path)
            })
            .collect();
        Self { roots: Mutex::new(roots), persistence_path }
    }

    fn persist(&self, roots: &[PathBuf]) -> Result<(), String> {
        let values: Vec<String> = roots.iter().map(|path| path.to_string_lossy().into_owned()).collect();
        let serialized = serde_json::to_vec_pretty(&values).map_err(|e| e.to_string())?;
        if let Some(parent) = self.persistence_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create workspace settings directory: {e}"))?;
        }
        // Never open a predictable temporary path with truncate(true): a pre-created
        // symlink there could redirect this write outside the app settings directory.
        let (temporary, mut file) = create_workspace_permissions_temp(&self.persistence_path)?;
        let write_result = file.write_all(&serialized)
            .map_err(|e| format!("Could not save workspace permissions: {e}"))
            .and_then(|()| file.sync_all().map_err(|e| format!("Could not flush workspace permissions: {e}")));
        drop(file);
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }
        #[cfg(windows)]
        {
            // Windows rename does not replace an existing destination. Keep a
            // rollback copy so a failed replacement never destroys the last
            // saved permission list.
            let backup = self.persistence_path.with_extension("json.bak");
            if backup.exists() {
                fs::remove_file(&backup)
                    .map_err(|e| format!("Could not clear old workspace permission backup: {e}"))?;
            }
            let had_previous = self.persistence_path.exists();
            if had_previous {
                fs::rename(&self.persistence_path, &backup)
                    .map_err(|e| format!("Could not preserve existing workspace permissions: {e}"))?;
            }
            if let Err(error) = fs::rename(&temporary, &self.persistence_path) {
                if had_previous {
                    let _ = fs::rename(&backup, &self.persistence_path);
                }
                return Err(format!("Could not finalize workspace permissions: {error}"));
            }
            if had_previous {
                let _ = fs::remove_file(&backup);
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            fs::rename(&temporary, &self.persistence_path)
                .map_err(|e| format!("Could not finalize workspace permissions: {e}"))
        }
    }

    /// Opens an approved directory through a pinned root handle. All subsequent
    /// child lookups are relative to that handle, so replacing a parent path
    /// after validation cannot redirect the operation outside the approved tree.
    pub(crate) fn open_approved_directory(&self, path: &Path) -> Result<(CapabilityDir, PathBuf), String> {
        if path.components().any(|component| matches!(component, std::path::Component::ParentDir)) {
            return Err("The requested path contains an invalid directory traversal.".into());
        }
        let root = self.allowed_root_for(path)?;
        let canonical_path = fs::canonicalize(path)
            .map_err(|error| format!("Could not resolve the requested directory: {error}"))?;
        let canonical_relative = canonical_path.strip_prefix(&root)
            .map_err(|_| "The requested path is outside an approved directory.")?;
        let relative_count = canonical_relative.components()
            .filter(|component| matches!(component, std::path::Component::Normal(_)))
            .count();

        // macOS may expose the same temporary directory through a non-canonical
        // prefix (for example /var -> /private/var). Reconstruct the caller's
        // original root alias from the same number of trailing components, then
        // verify that alias resolves to the already-approved canonical root.
        // This preserves child names so a symlink inside the approved root is
        // still opened component-by-component with no-follow semantics.
        let mut alias_root = path.to_path_buf();
        let mut names = Vec::with_capacity(relative_count);
        for _ in 0..relative_count {
            let name = alias_root.file_name()
                .ok_or_else(|| "The requested path does not resolve beneath its approved root.".to_string())?
                .to_os_string();
            names.push(name);
            alias_root = alias_root.parent()
                .ok_or_else(|| "The requested path does not resolve beneath its approved root.".to_string())?
                .to_path_buf();
        }
        if fs::canonicalize(&alias_root)
            .map_err(|error| format!("Could not verify the approved root alias: {error}"))? != root {
            return Err("The requested path does not resolve beneath its approved root.".into());
        }
        let alias_metadata = fs::symlink_metadata(&alias_root)
            .map_err(|error| format!("Could not inspect the approved root alias: {error}"))?;
        if !alias_metadata.is_dir() || is_link_or_reparse(&alias_metadata) {
            return Err("The requested path uses a symbolic link for its approved root.".into());
        }
        let mut relative = PathBuf::new();
        for name in names.into_iter().rev() { relative.push(name); }

        let mut directory = open_approved_root_handle(&root)?;
        // Resolve one component at a time. open_dir_nofollow only rejects the
        // component it opens, so passing a multi-component path could still
        // traverse an intermediate symlink on some hosts.
        for component in relative.components() {
            match component {
                std::path::Component::Normal(name) => {
                    #[cfg(windows)]
                    {
                        let mut options = CapabilityOpenOptions::new();
                        options.read(true).maybe_dir(true).follow(FollowSymlinks::No);
                        // A destination directory handle passed to
                        // SetFileInformationByHandle(FileRenameInfo) must carry
                        // FILE_ADD_FILE / FILE_ADD_SUBDIRECTORY. Open each child
                        // relative to the already pinned parent so this does not
                        // reintroduce an ambient-path race.
                        options.access_mode(0x8000_0000 | 0x0000_0002 | 0x0000_0004);
                        let child = directory.open_with(Path::new(name), &options)
                            .map_err(|error| format!("Could not open a directory inside the approved workspace: {error}"))?
                            .into_std();
                        let metadata = child.metadata()
                            .map_err(|error| format!("Could not inspect a directory inside the approved workspace: {error}"))?;
                        if !metadata.is_dir() || is_link_or_reparse(&metadata) {
                            return Err("The requested workspace path contains a link or non-directory entry.".into());
                        }
                        directory = CapabilityDir::from_std_file(child);
                    }
                    #[cfg(not(windows))]
                    {
                        directory = directory.open_dir_nofollow(name)
                            .map_err(|error| format!("Could not open a directory inside the approved workspace: {error}"))?;
                    }
                }
                _ => return Err("The requested path contains an invalid directory traversal.".into()),
            }
        }
        Ok((directory, root))
    }

    pub(crate) fn open_approved_parent(&self, path: &Path) -> Result<(CapabilityDir, OsString, PathBuf), String> {
        let parent = path.parent()
            .ok_or_else(|| "The selected file must be inside an approved directory.".to_string())?;
        let name = path.file_name()
            .ok_or_else(|| "The selected file has no valid name.".to_string())?
            .to_os_string();
        let (directory, root) = self.open_approved_directory(parent)?;
        Ok((directory, name, root))
    }

    pub(crate) fn allowed_root_for(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = fs::canonicalize(path).map_err(|e| format!("Could not resolve the requested path: {e}"))?;
        let roots = self.roots.lock().map_err(|_| "Workspace permission lock is unavailable.")?;
        roots.iter().find(|root| canonical.starts_with(root)).cloned()
            .ok_or_else(|| "This path is outside the directories explicitly allowed in NEXUS.".to_string())
    }

}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    name: String,
    path: String,
    kind: String,
    size_bytes: u64,
    modified_at_ms: Option<u64>,
}

#[tauri::command]
pub fn list_workspace_directories(access: State<'_, WorkspaceAccess>) -> Result<Vec<String>, String> {
    let roots = access.roots.lock().map_err(|_| "Workspace permission lock is unavailable.")?;
    Ok(roots.iter().map(|path| path.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub fn grant_workspace_directory(path: String, access: State<'_, WorkspaceAccess>) -> Result<Vec<String>, String> {
    if path.trim().is_empty() || path.len() > 4096 {
        return Err("Enter a valid directory path (up to 4096 characters).".into());
    }
    let canonical = fs::canonicalize(&path).map_err(|e| format!("Could not open that directory: {e}"))?;
    if !canonical.is_dir() {
        return Err("The selected path is not a directory.".into());
    }
    let mut roots = access.roots.lock().map_err(|_| "Workspace permission lock is unavailable.")?;
    if !roots.iter().any(|root| root == &canonical) {
        if roots.len() >= MAX_ALLOWED_ROOTS {
            return Err(format!("NEXUS supports up to {MAX_ALLOWED_ROOTS} explicitly allowed directories."));
        }
        roots.push(canonical);
        roots.sort();
        access.persist(&roots)?;
    }
    Ok(roots.iter().map(|root| root.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub fn revoke_workspace_directory(path: String, access: State<'_, WorkspaceAccess>) -> Result<Vec<String>, String> {
    let target = fs::canonicalize(&path).unwrap_or_else(|_| PathBuf::from(&path));
    let mut roots = access.roots.lock().map_err(|_| "Workspace permission lock is unavailable.")?;
    roots.retain(|root| root != &target);
    access.persist(&roots)?;
    Ok(roots.iter().map(|root| root.to_string_lossy().into_owned()).collect())
}

fn list_workspace_entries_capability(
    access: &WorkspaceAccess,
    requested: &Path,
) -> Result<Vec<WorkspaceEntry>, String> {
    let (directory, root) = access.open_approved_directory(requested)?;
    let canonical_requested = fs::canonicalize(requested)
        .map_err(|error| format!("Could not resolve the requested directory: {error}"))?;
    let relative = canonical_requested.strip_prefix(&root)
        .map_err(|_| "The requested location is outside an approved directory.")?;
    let visible_directory = root.join(relative);
    let mut entries = Vec::new();
    let iterator = directory.entries().map_err(|e| format!("Could not read directory: {e}"))?;
    for item in iterator.take(MAX_DIRECTORY_ENTRIES) {
        let item = item.map_err(|e| format!("Could not inspect a directory entry: {e}"))?;
        let name = item.file_name();
        let metadata = match directory.symlink_metadata(&name) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if is_capability_link_or_reparse(&metadata) { continue; }
        let (kind, size_bytes, modified_at_ms) = if metadata.is_dir() {
            let child = match open_child_directory(&directory, &name) { Ok(value) => value, Err(_) => continue };
            let opened = child.dir_metadata().map_err(|e| format!("Could not inspect directory entry: {e}"))?;
            let modified = opened.modified().ok()
                .and_then(|time| time.duration_since(cap_std::time::SystemClock::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64);
            ("directory", opened.len(), modified)
        } else if metadata.is_file() {
            let file = match open_capability_file(&directory, &name, true, false, false) { Ok(value) => value, Err(_) => continue };
            let opened = file.metadata().map_err(|e| format!("Could not inspect file entry: {e}"))?;
            if !opened.is_file() { continue; }
            ensure_no_external_hard_links(&file)?;
            let modified = opened.modified().ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64);
            ("file", opened.len(), modified)
        } else {
            continue;
        };
        entries.push(WorkspaceEntry {
            name: name.to_string_lossy().into_owned(),
            path: visible_directory.join(&name).to_string_lossy().into_owned(),
            kind: kind.into(),
            size_bytes,
            modified_at_ms,
        });
    }
    entries.sort_by(|a, b| (a.kind != "directory").cmp(&(b.kind != "directory")).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[tauri::command]
pub fn list_workspace_entries(path: String, access: State<'_, WorkspaceAccess>) -> Result<Vec<WorkspaceEntry>, String> {
    list_workspace_entries_capability(&access, Path::new(&path))
}

const MAX_SEARCH_VISITED_ENTRIES: usize = 5_000;
const MAX_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_DEPTH: usize = 12;

#[cfg(test)]
fn search_workspace_entries_in(root: &Path, start: &Path, query: &str) -> Result<Vec<WorkspaceEntry>, String> {
    if query.trim().is_empty() || query.len() > 256 {
        return Err("Search query must contain 1 to 256 characters.".into());
    }
    let canonical_root = fs::canonicalize(root).map_err(|e| format!("Could not resolve approved root: {e}"))?;
    let canonical_start = fs::canonicalize(start).map_err(|e| format!("Could not open search directory: {e}"))?;
    if !canonical_start.is_dir() || !canonical_start.starts_with(&canonical_root) {
        return Err("Search location is not inside an approved directory.".into());
    }

    let needle = query.to_lowercase();
    let mut pending = vec![(canonical_start, 0usize)];
    let mut visited = 0usize;
    let mut results = Vec::new();

    'walk: while let Some((directory, depth)) = pending.pop() {
        let iterator = fs::read_dir(&directory).map_err(|e| format!("Could not search directory: {e}"))?;
        for item in iterator {
            let item = item.map_err(|e| format!("Could not inspect search entry: {e}"))?;
            visited += 1;
            if visited > MAX_SEARCH_VISITED_ENTRIES { break 'walk; }

            let entry_path = item.path();
            let link_metadata = match fs::symlink_metadata(&entry_path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if is_link_or_reparse(&link_metadata) { continue; }
            let canonical = match fs::canonicalize(&entry_path) {
                Ok(value) if value.starts_with(&canonical_root) => value,
                _ => continue,
            };
            let metadata = match fs::metadata(&canonical) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let name = item.file_name().to_string_lossy().into_owned();
            let kind = if metadata.is_dir() { "directory" } else if metadata.is_file() { "file" } else { "other" };

            if name.to_lowercase().contains(&needle) && results.len() < MAX_SEARCH_RESULTS {
                let modified_at_ms = metadata.modified().ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64);
                results.push(WorkspaceEntry {
                    name,
                    path: canonical.to_string_lossy().into_owned(),
                    kind: kind.into(),
                    size_bytes: metadata.len(),
                    modified_at_ms,
                });
            }
            if metadata.is_dir() && depth < MAX_SEARCH_DEPTH {
                pending.push((canonical, depth + 1));
            }
            if results.len() >= MAX_SEARCH_RESULTS { break 'walk; }
        }
    }

    results.sort_by(|a, b| (a.kind != "directory").cmp(&(b.kind != "directory"))
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(results)
}

fn search_workspace_entries_capability(
    access: &WorkspaceAccess,
    start: &Path,
    query: &str,
) -> Result<Vec<WorkspaceEntry>, String> {
    if query.trim().is_empty() || query.len() > 256 {
        return Err("Search query must contain 1 to 256 characters.".into());
    }
    let (start_directory, root) = access.open_approved_directory(start)?;
    let canonical_start = fs::canonicalize(start)
        .map_err(|error| format!("Could not resolve the search directory: {error}"))?;
    let start_relative = canonical_start.strip_prefix(&root)
        .map_err(|_| "Search location is outside an approved directory.")?;
    let needle = query.to_lowercase();
    let mut pending: Vec<(CapabilityDir, PathBuf, usize)> =
        vec![(start_directory, start_relative.to_path_buf(), 0)];
    let mut visited = 0usize;
    let mut results = Vec::new();

    'walk: while let Some((directory, relative_directory, depth)) = pending.pop() {
        let iterator = directory.entries()
            .map_err(|error| format!("Could not search directory: {error}"))?;
        for item in iterator {
            let item = match item { Ok(value) => value, Err(_) => continue };
            visited += 1;
            if visited > MAX_SEARCH_VISITED_ENTRIES { break 'walk; }
            let name = item.file_name();
            let metadata = match directory.symlink_metadata(&name) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if is_capability_link_or_reparse(&metadata) { continue; }
            let (kind, size_bytes, modified_at_ms) = if metadata.is_dir() {
                if depth < MAX_SEARCH_DEPTH {
                    if let Ok(child) = open_child_directory(&directory, &name) {
                        pending.push((child, relative_directory.join(&name), depth + 1));
                    }
                }
                let modified = metadata.modified().ok()
                    .and_then(|time| time.duration_since(cap_std::time::SystemClock::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64);
                ("directory", metadata.len(), modified)
            } else if metadata.is_file() {
                let file = match open_capability_file(&directory, &name, true, false, false) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let opened = file.metadata().map_err(|error| format!("Could not inspect search entry: {error}"))?;
                if !opened.is_file() { continue; }
                ensure_no_external_hard_links(&file)?;
                let modified = opened.modified().ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64);
                ("file", opened.len(), modified)
            } else {
                continue;
            };
            if name.to_string_lossy().to_lowercase().contains(&needle) {
                results.push(WorkspaceEntry {
                    name: name.to_string_lossy().into_owned(),
                    path: root.join(&relative_directory).join(&name).to_string_lossy().into_owned(),
                    kind: kind.into(),
                    size_bytes,
                    modified_at_ms,
                });
                if results.len() >= MAX_SEARCH_RESULTS { break 'walk; }
            }
        }
    }
    results.sort_by(|a, b| (a.kind != "directory").cmp(&(b.kind != "directory"))
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(results)
}

#[tauri::command]
pub fn search_workspace_entries(path: String, query: String, access: State<'_, WorkspaceAccess>) -> Result<Vec<WorkspaceEntry>, String> {
    search_workspace_entries_capability(&access, Path::new(&path), &query)
}

fn read_workspace_file_inner(path: &str, access: &WorkspaceAccess) -> Result<String, String> {
    if path.trim().is_empty() || path.len() > 4096 {
        return Err("The selected file path is invalid.".into());
    }
    let requested = Path::new(path);
    let (parent_directory, name, _root) = access.open_approved_parent(requested)?;
    nexus_workspace::read_text(&parent_directory, &name, MAX_TEXT_FILE_BYTES)
}

#[tauri::command]
pub fn read_workspace_file(path: String, access: State<'_, WorkspaceAccess>) -> Result<String, String> {
    read_workspace_file_inner(&path, &access)
}

#[tauri::command]
pub fn snapshot_workspace_file(path: String, access: State<'_, WorkspaceAccess>) -> Result<serde_json::Value, String> {
    if path.trim().is_empty() || path.len() > 4096 {
        return Err("The selected file path is invalid.".into());
    }
    let (parent, name, _) = access.open_approved_parent(Path::new(&path))?;
    let (content, revision) = nexus_workspace::snapshot_text(&parent, &name)?;
    Ok(serde_json::json!({ "content": content, "revision": revision }))
}

fn write_workspace_file_inner(
    path: &str,
    content: &str,
    expected_content: Option<&str>,
    access: &WorkspaceAccess,
) -> Result<(), String> {
    if path.trim().is_empty() || path.len() > 4096 || content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("The file path or content exceeds the allowed size.".into());
    }
    if expected_content.map_or(false, |expected| expected.len() as u64 > MAX_TEXT_FILE_BYTES) {
        return Err("The expected file snapshot exceeds the 2 MB edit limit.".into());
    }

    let requested = PathBuf::from(path);
    let (parent_directory, name, _root) = access.open_approved_parent(&requested)?;
    match parent_directory.symlink_metadata(Path::new(&name)) {
        Ok(metadata) => {
            if expected_content.is_none() {
                return Err("A file or folder already exists at this path. Choose a different name instead of overwriting it.".into());
            }
            if is_capability_link_or_reparse(&metadata) || !metadata.is_file() {
                return Err("NEXUS will not overwrite a symbolic link or non-file entry.".into());
            }
            // Open relative to the pinned parent handle and refuse a final
            // symlink/reparse point. The comparison and write use this same handle.
            let mut file = open_capability_file(&parent_directory, &name, true, true, false)
                .map_err(|error| {
                    if error.contains("hard-linked") {
                        error
                    } else {
                        "The file changed or is no longer safely readable. Reload it before saving.".to_string()
                    }
                })?;
            let opened_metadata = file.metadata()
                .map_err(|_| "Could not inspect the opened file safely.".to_string())?;
            if !opened_metadata.is_file() {
                return Err("NEXUS can edit regular files only, not links or special entries.".into());
            }
            ensure_no_external_hard_links(&file)?;
            let opened_metadata = file.metadata()
                .map_err(|_| "Could not inspect the opened file safely.".to_string())?;
            if opened_metadata.len() > MAX_TEXT_FILE_BYTES {
                return Err("The file changed and now exceeds the 2 MB edit limit. Reload it before saving.".into());
            }

            if let Some(expected) = expected_content {
                let mut current_bytes = Vec::with_capacity(opened_metadata.len() as usize);
                {
                    let mut limited = (&mut file).take(MAX_TEXT_FILE_BYTES + 1);
                    limited.read_to_end(&mut current_bytes)
                        .map_err(|_| "The file changed or is no longer readable. Reload it before saving.".to_string())?;
                }
                if current_bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
                    return Err("The file changed and now exceeds the 2 MB edit limit. Reload it before saving.".into());
                }
                let current = String::from_utf8(current_bytes)
                    .map_err(|_| "The file changed or is no longer readable as UTF-8. Reload it before saving.".to_string())?;
                if current != expected {
                    return Err("File changed outside NEXUS since it was opened. Your draft is preserved; reload the file before saving to avoid overwriting newer changes.".into());
                }
            }
            // Windows replacement is not yet transactionally safe. Never
            // truncate the user's original file in the shipped desktop host:
            // a crash or failed write would destroy the approved snapshot.
            // Creation of new files remains available through create_new.
            #[cfg(windows)]
            return Err("Safe replacement of existing Windows workspace files is not available yet; the original file and your draft are preserved.".into());

            #[cfg(not(windows))]
            {
                file.set_len(0).map_err(|error| format!("Could not truncate the approved file: {error}"))?;
                file.seek(SeekFrom::Start(0)).map_err(|error| format!("Could not seek in the approved file: {error}"))?;
                file.write_all(content.as_bytes()).map_err(|error| format!("Could not save file: {error}"))?;
                file.sync_all().map_err(|error| format!("Could not flush file: {error}"))
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if expected_content.is_some() {
                return Err("File was removed or moved outside NEXUS since it was opened. Your draft is preserved.".into());
            }
            // create_new is atomic and refuses to replace a path that appeared
            // after the preflight check.
            let mut file = open_capability_file(&parent_directory, &name, false, true, true)
                .map_err(|error| format!("Could not create file without replacing an existing entry: {error}"))?;
            file.write_all(content.as_bytes()).map_err(|error| format!("Could not save file: {error}"))?;
            file.sync_all().map_err(|error| format!("Could not flush file: {error}"))
        }
        Err(error) => Err(format!("Could not inspect the target file: {error}")),
    }
}

#[tauri::command]
pub fn write_workspace_file(path: String, content: String, access: State<'_, WorkspaceAccess>) -> Result<(), String> {
    write_workspace_file_inner(&path, &content, None, &access)
}

#[tauri::command]
pub fn write_workspace_file_checked(
    path: String,
    content: String,
    expected_content: String,
    access: State<'_, WorkspaceAccess>,
) -> Result<(), String> {
    write_workspace_file_inner(&path, &content, Some(&expected_content), &access)
}

fn create_workspace_directory_inner(path: &str, access: &WorkspaceAccess) -> Result<(), String> {
    if path.trim().is_empty() || path.len() > 4096 { return Err("Enter a valid directory path.".into()); }
    let requested = PathBuf::from(path);
    if requested.parent().is_none() {
        return Err("The new directory must be inside an allowed directory.".into());
    }
    let (parent_directory, name, _root) = access.open_approved_parent(&requested)?;
    if parent_directory.symlink_metadata(Path::new(&name)).is_ok() {
        return Err("A file or directory already exists at that path.".into());
    }
    parent_directory.create_dir(Path::new(&name))
        .map_err(|e| format!("Could not create directory: {e}"))
}

#[tauri::command]
pub fn create_workspace_directory(path: String, access: State<'_, WorkspaceAccess>) -> Result<(), String> {
    create_workspace_directory_inner(&path, &access)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(unix, windows))]
    #[test]
    fn workspace_file_reads_reject_final_component_symlinks_even_when_target_is_approved() {
        #[cfg(unix)]
        use std::os::unix::fs::symlink;
        #[cfg(windows)]
        use std::os::windows::fs::symlink_file as symlink;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-read-no-follow-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let target = root.join("target.txt");
        fs::write(&target, "approved target").expect("create target");
        let link = root.join("linked.txt");
        symlink(&target, &link).expect("create in-root symbolic link");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        let result = read_workspace_file_inner(link.to_str().unwrap(), &access);
        assert!(result.is_err(), "a final-component symlink must not be followed even when its target is inside the approved root");
        assert_eq!(fs::read_to_string(&target).unwrap(), "approved target");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn native_workspace_read_rejects_junction_within_approved_root() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("nexus-tauri-junction-{}-{nonce}", std::process::id()));
        let target = root.join("target");
        let junction = root.join("junction");
        fs::create_dir_all(&target).unwrap();
        let file = target.join("note.txt");
        fs::write(&file, "approved text").unwrap();
        assert!(std::process::Command::new("cmd").args(["/d", "/c", "mklink", "/J"])
            .arg(&junction).arg(&target).status().unwrap().success());
        let access = WorkspaceAccess::for_test(vec![fs::canonicalize(&root).unwrap()], root.join("permissions.json"));
        assert_eq!(read_workspace_file_inner(file.to_str().unwrap(), &access).unwrap(), "approved text");
        let redirected = junction.join("note.txt");
        assert!(read_workspace_file_inner(redirected.to_str().unwrap(), &access).is_err());
        fs::remove_dir(junction).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn workspace_file_reads_reject_hard_linked_files() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-hardlink-read-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let target = root.join("notes.txt");
        let alias = base.join("outside-alias.txt");
        fs::write(&target, "private content").expect("create file");
        fs::hard_link(&target, &alias).expect("create external hard link");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        let result = read_workspace_file_inner(target.to_str().unwrap(), &access);
        assert!(result.unwrap_err().contains("hard-linked"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "private content");
        assert_eq!(fs::read_to_string(&alias).unwrap(), "private content");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn checked_writes_reject_hard_linked_files() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-hardlink-write-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let target = root.join("notes.txt");
        let alias = base.join("outside-alias.txt");
        fs::write(&target, "original").expect("create file");
        fs::hard_link(&target, &alias).expect("create external hard link");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        let result = write_workspace_file_inner(target.to_str().unwrap(), "updated", Some("original"), &access);
        assert!(result.unwrap_err().contains("hard-linked"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        assert_eq!(fs::read_to_string(&alias).unwrap(), "original");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn creating_a_file_never_truncates_an_existing_file() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-create-no-overwrite-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let target = root.join("important.txt");
        fs::write(&target, "keep original contents").expect("create existing file");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        let result = write_workspace_file_inner(target.to_str().unwrap(), "", None, &access);
        assert!(result.unwrap_err().contains("already exists"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "keep original contents");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn file_reads_and_writes_refuse_to_follow_symbolic_links() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-no-follow-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let outside = base.join("outside.txt");
        fs::write(&outside, "outside data").expect("create outside file");
        let link = root.join("linked.txt");
        symlink(&outside, &link).expect("create symbolic link");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        assert!(open_regular_file_readonly(&link).is_err());
        assert!(open_regular_file_readwrite(&link).is_err(), "checked edit open must reject final-component symlinks");
        let result = write_workspace_file_inner(link.to_str().unwrap(), "changed", None, &access);
        assert!(result.is_err(), "write must not follow a symlink target");
        assert_eq!(fs::read_to_string(&outside).unwrap(), "outside data");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(not(windows))]
    #[test]
    fn checked_write_rejects_external_changes_without_overwriting_them() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-checked-write-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let target = root.join("notes.txt");
        fs::write(&target, "original").expect("create file");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        write_workspace_file_inner(target.to_str().unwrap(), "updated", Some("original"), &access)
            .expect("write unchanged file");
        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");

        fs::write(&target, "external edit").expect("simulate external edit");
        let result = write_workspace_file_inner(target.to_str().unwrap(), "stale draft", Some("updated"), &access);
        assert!(result.unwrap_err().contains("File changed outside NEXUS"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "external edit");

        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(windows)]
    #[test]
    fn windows_new_file_creation_remains_available_when_replacement_is_gated() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!(
            "nexus-windows-create-gate-{}-{nonce}", std::process::id()
        ));
        let root = base.join("approved");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("new.txt");
        let access = WorkspaceAccess::for_test(
            vec![fs::canonicalize(&root).unwrap()],
            base.join("permissions.json"),
        );

        write_workspace_file_inner(target.to_str().unwrap(), "created", None, &access)
            .expect("new file creation must remain available");
        assert_eq!(fs::read_to_string(&target).unwrap(), "created");
        let error = write_workspace_file_inner(
            target.to_str().unwrap(), "changed", Some("created"), &access
        ).unwrap_err();
        assert!(error.contains("not available yet"), "{error}");
        assert_eq!(fs::read_to_string(&target).unwrap(), "created");
        fs::remove_dir_all(base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_checked_write_fails_closed_without_truncating_existing_file() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!(
            "nexus-windows-checked-write-gate-{}-{nonce}", std::process::id()
        ));
        let root = base.join("approved");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("important.txt");
        fs::write(&target, "original").unwrap();
        let access = WorkspaceAccess::for_test(
            vec![fs::canonicalize(&root).unwrap()],
            base.join("permissions.json"),
        );

        let error = write_workspace_file_inner(
            target.to_str().unwrap(), "replacement", Some("original"), &access
        ).unwrap_err();
        assert!(error.contains("not available yet"), "{error}");
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        assert!(write_workspace_file_inner(
            target.to_str().unwrap(), "replacement", Some("stale"), &access
        ).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn checked_write_rejects_oversized_expected_snapshot_before_reading_or_mutating() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-checked-size-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let target = root.join("notes.txt");
        fs::write(&target, "stable").expect("create file");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };
        let oversized_snapshot = "x".repeat(MAX_TEXT_FILE_BYTES as usize + 1);
        let result = write_workspace_file_inner(target.to_str().unwrap(), "replacement", Some(&oversized_snapshot), &access);
        assert!(result.unwrap_err().contains("expected file snapshot exceeds"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "stable");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn checked_write_rejects_files_removed_since_they_were_opened() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-checked-missing-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let target = root.join("removed.txt");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };
        let result = write_workspace_file_inner(target.to_str().unwrap(), "stale draft", Some("original"), &access);
        assert!(result.unwrap_err().contains("removed or moved"));
        assert!(!target.exists());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn approved_directory_open_rejects_a_symlink_alias_to_the_root() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-root-alias-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        let alias = base.join("approved-alias");
        fs::create_dir_all(&root).expect("create approved root");
        symlink(&root, &alias).expect("create root alias symlink");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        assert!(access.allowed_root_for(&alias).is_ok());
        assert!(access.open_approved_directory(&alias).is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn approved_directory_open_rejects_intermediate_symlinks_even_when_target_is_inside_root() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-intermediate-symlink-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        let real_directory = root.join("real");
        fs::create_dir_all(real_directory.join("nested")).expect("create approved nested directory");
        symlink(&real_directory, root.join("redirect")).expect("create in-root intermediate symlink");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        // Canonical containment alone accepts this path because the link target
        // remains inside the approved root. Every component must still be opened
        // without following the intermediate link.
        assert!(access.allowed_root_for(&root.join("redirect").join("nested")).is_ok());
        let result = access.open_approved_directory(&root.join("redirect").join("nested"));
        assert!(result.is_err(), "an intermediate symlink must not be followed even when its target remains inside the approved root");
        assert!(real_directory.join("nested").is_dir());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn pinned_workspace_directory_handles_ignore_parent_path_replacement() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-pinned-parent-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        let parent = root.join("documents");
        let outside = base.join("outside");
        fs::create_dir_all(&parent).expect("create approved parent");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::write(parent.join("note.txt"), "approved contents").expect("write approved file");
        fs::write(outside.join("note.txt"), "outside contents").expect("write outside file");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };

        let (pinned, _) = access.open_approved_directory(&parent).expect("open pinned parent");
        fs::rename(&parent, root.join("documents-original")).expect("move original parent");
        symlink(&outside, &parent).expect("replace parent path with outside symlink");

        let file = open_capability_file(&pinned, std::ffi::OsStr::new("note.txt"), true, false, false)
            .expect("open file relative to pinned directory handle");
        let mut contents = String::new();
        file.take(MAX_TEXT_FILE_BYTES + 1).read_to_string(&mut contents).expect("read pinned file");
        assert_eq!(contents, "approved contents");
        assert_eq!(fs::read_to_string(outside.join("note.txt")).unwrap(), "outside contents");

        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn path_containment_uses_path_components_not_string_prefixes() {
        let root = PathBuf::from("/safe/work");
        assert!(Path::new("/safe/work/project").starts_with(&root));
        assert!(!Path::new("/safe/work-evil/project").starts_with(&root));
        assert!(!Path::new("/safe/other").starts_with(&root));
    }

    #[test]
    fn access_is_granted_only_for_canonical_paths_inside_an_approved_root() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-{}-{nonce}", std::process::id()));
        let root = base.join("allowed");
        let sibling = base.join("allowed-escape");
        fs::create_dir_all(&root).expect("create allowed root");
        fs::create_dir_all(&sibling).expect("create sibling");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };
        assert!(access.allowed_root_for(&root).is_ok());
        assert!(access.allowed_root_for(&sibling).is_err());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn permission_persistence_does_not_follow_a_preexisting_temporary_symlink() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-persist-symlink-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        let settings = base.join("settings");
        fs::create_dir_all(&root).expect("create approved root");
        fs::create_dir_all(&settings).expect("create settings directory");
        let persistence_path = settings.join("allowed-workspace-directories.json");
        let outside = base.join("outside.txt");
        fs::write(&outside, "must remain untouched").expect("create outside file");
        let predictable_temp = persistence_path.with_extension("json.tmp");
        symlink(&outside, &predictable_temp).expect("create pre-existing temporary symlink");
        let access = WorkspaceAccess {
            roots: Mutex::new(Vec::new()),
            persistence_path: persistence_path.clone(),
        };

        access.persist(&[fs::canonicalize(&root).expect("canonical root")])
            .expect("persist without following the predictable temporary symlink");
        assert_eq!(fs::read_to_string(&outside).expect("read outside file"), "must remain untouched");
        assert!(fs::symlink_metadata(&predictable_temp).expect("inspect symlink").file_type().is_symlink());
        let reloaded = WorkspaceAccess::load(persistence_path);
        assert_eq!(reloaded.roots.lock().expect("lock roots").len(), 1);
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn permissions_persist_and_reload_after_multiple_updates() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-persist-{}-{nonce}", std::process::id()));
        let first = base.join("first");
        let second = base.join("second");
        fs::create_dir_all(&first).expect("create first root");
        fs::create_dir_all(&second).expect("create second root");
        let persistence_path = base.join("settings").join("allowed-workspace-directories.json");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&first).expect("canonical first root")]),
            persistence_path: persistence_path.clone(),
        };

        access.persist(&[fs::canonicalize(&first).expect("canonical first")]).expect("persist first root");
        access.persist(&[
            fs::canonicalize(&first).expect("canonical first"),
            fs::canonicalize(&second).expect("canonical second"),
        ]).expect("replace with two roots");

        let reloaded = WorkspaceAccess::load(persistence_path);
        let roots = reloaded.roots.lock().expect("lock reloaded roots");
        assert_eq!(roots.len(), 2);
        assert!(roots.contains(&fs::canonicalize(&first).expect("canonical first")));
        assert!(roots.contains(&fs::canonicalize(&second).expect("canonical second")));
        drop(roots);
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn permission_reload_refuses_a_symlinked_permissions_file() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-permission-file-symlink-{}-{nonce}", std::process::id()));
        let approved = base.join("approved");
        let settings = base.join("settings");
        fs::create_dir_all(&approved).expect("create approved root");
        fs::create_dir_all(&settings).expect("create settings directory");
        let outside = base.join("outside-permissions.json");
        let persistence_path = settings.join("permissions.json");
        fs::write(&outside, serde_json::to_vec(&vec![fs::canonicalize(&approved).expect("canonical root").to_string_lossy()]).expect("serialize outside permissions"))
            .expect("write outside permissions");
        symlink(&outside, &persistence_path).expect("replace permissions file with symlink");

        let reloaded = WorkspaceAccess::load(persistence_path);
        assert!(reloaded.roots.lock().expect("lock roots").is_empty());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn permission_reload_rejects_oversized_files_and_excessive_root_lists() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-permission-limits-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&base).expect("create test directory");
        let persistence_path = base.join("permissions.json");

        let too_many_roots = vec!["/".to_string(); MAX_ALLOWED_ROOTS + 1];
        fs::write(&persistence_path, serde_json::to_vec(&too_many_roots).expect("serialize excessive roots"))
            .expect("write excessive roots");
        assert!(WorkspaceAccess::load(persistence_path.clone()).roots.lock().expect("lock roots").is_empty());

        fs::write(&persistence_path, vec![b' '; MAX_PERMISSION_FILE_BYTES as usize + 1])
            .expect("write oversized permissions file");
        assert!(WorkspaceAccess::load(persistence_path).roots.lock().expect("lock roots").is_empty());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn permission_reload_does_not_retarget_a_grant_through_a_replaced_root_symlink() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-root-reload-symlink-{}-{nonce}", std::process::id()));
        let approved = base.join("approved");
        let outside = base.join("outside");
        let settings = base.join("settings");
        fs::create_dir_all(&approved).expect("create originally approved root");
        fs::create_dir_all(&outside).expect("create outside directory");
        fs::create_dir_all(&settings).expect("create settings directory");
        let persistence_path = settings.join("permissions.json");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&approved).expect("canonical approved root")]),
            persistence_path: persistence_path.clone(),
        };
        access.persist(&[fs::canonicalize(&approved).expect("canonical approved root")])
            .expect("persist approved root");

        fs::remove_dir(&approved).expect("remove original approved root");
        symlink(&outside, &approved).expect("replace approved path with symlink");
        let reloaded = WorkspaceAccess::load(persistence_path);
        assert!(reloaded.roots.lock().expect("lock reloaded roots").is_empty());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn permission_reload_does_not_retarget_a_grant_through_a_replaced_ancestor_symlink() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-ancestor-reload-symlink-{}-{nonce}", std::process::id()));
        let approved_parent = base.join("approved-parent");
        let approved = approved_parent.join("approved");
        let outside = base.join("outside");
        let outside_root = outside.join("approved");
        let settings = base.join("settings");
        fs::create_dir_all(&approved).expect("create originally approved root");
        fs::create_dir_all(&outside_root).expect("create outside target root");
        fs::create_dir_all(&settings).expect("create settings directory");
        let persistence_path = settings.join("permissions.json");
        let canonical_approved = fs::canonicalize(&approved).expect("canonical approved root");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![canonical_approved.clone()]),
            persistence_path: persistence_path.clone(),
        };
        access.persist(&[canonical_approved]).expect("persist approved root");

        fs::remove_dir_all(&approved_parent).expect("remove original ancestor");
        symlink(&outside, &approved_parent).expect("replace approved ancestor with symlink");
        let reloaded = WorkspaceAccess::load(persistence_path);
        assert!(reloaded.roots.lock().expect("lock reloaded roots").is_empty());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn permission_persistence_rejects_no_valid_paths_by_default() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-invalid-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&base).expect("create test directory");
        let persistence_path = base.join("allowed-workspace-directories.json");
        fs::write(&persistence_path, r#"["/path/that/does/not/exist"]"#).expect("write stale permission");
        let access = WorkspaceAccess::load(persistence_path);
        assert!(access.roots.lock().expect("lock roots").is_empty());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[test]
    fn workspace_listing_and_name_search_accept_canonical_root_aliases() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-canonical-alias-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(root.join("notes")).expect("create approved directory");
        fs::write(root.join("notes").join("meeting.md"), "needle").expect("write note");
        let access = WorkspaceAccess::for_test(
            vec![fs::canonicalize(&root).expect("canonical root")],
            base.join("permissions.json"),
        );

        let entries = list_workspace_entries_capability(&access, &root).expect("list approved directory");
        assert!(entries.iter().any(|entry| entry.name == "notes"));
        let results = search_workspace_entries_capability(&access, &root, "meeting")
            .expect("search approved directory");
        assert!(results.iter().any(|entry| entry.name == "meeting.md"));

        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn workspace_search_finds_nested_names_and_stays_inside_the_approved_root() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-search-{}-{nonce}", std::process::id()));
        let root = base.join("allowed");
        let nested = root.join("projects").join("notes");
        let sibling = base.join("outside");
        fs::create_dir_all(&nested).expect("create nested search directory");
        fs::create_dir_all(&sibling).expect("create outside directory");
        fs::write(root.join("notes.txt"), "root note").expect("write root note");
        fs::write(nested.join("meeting-notes.md"), "nested note").expect("write nested note");
        fs::write(sibling.join("secret-notes.txt"), "outside note").expect("write outside note");

        let results = search_workspace_entries_in(&root, &root, "notes").expect("search approved root");
        assert_eq!(results.len(), 3);
        let canonical_root = fs::canonicalize(&root).expect("canonical root");
        assert!(results.iter().all(|entry| Path::new(&entry.path).starts_with(&canonical_root)));
        assert!(results.iter().any(|entry| entry.name == "meeting-notes.md"));
        assert!(results.iter().any(|entry| entry.name == "notes" && entry.kind == "directory"));
        assert!(search_workspace_entries_in(&root, &root, " ").is_err());
        assert!(search_workspace_entries_in(&root, &sibling, "notes").is_err());
        fs::remove_dir_all(&base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn directory_creation_rejects_a_parent_symlink_that_escapes_the_approved_root() {
        use std::os::unix::fs::symlink;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-mkdir-symlink-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        let outside = base.join("outside");
        fs::create_dir_all(&root).expect("create approved root");
        fs::create_dir_all(&outside).expect("create outside directory");
        symlink(&outside, root.join("redirect")).expect("create outside parent symlink");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };
        let result = create_workspace_directory_inner(root.join("redirect").join("created").to_str().unwrap(), &access);
        assert!(result.is_err());
        assert!(!outside.join("created").exists());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn directory_creation_is_limited_to_approved_roots_and_never_replaces_existing_entries() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-mkdir-safe-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let access = WorkspaceAccess {
            roots: Mutex::new(vec![fs::canonicalize(&root).expect("canonical root")]),
            persistence_path: base.join("permissions.json"),
        };
        let created = root.join("new-folder");
        create_workspace_directory_inner(created.to_str().unwrap(), &access).expect("create folder");
        assert!(created.is_dir());
        assert!(create_workspace_directory_inner(created.to_str().unwrap(), &access).unwrap_err().contains("already exists"));
        assert!(create_workspace_directory_inner(base.join("outside").to_str().unwrap(), &access).is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn workspace_entry_limit_is_bounded() {
        assert_eq!(MAX_DIRECTORY_ENTRIES, 500);
        assert_eq!(MAX_TEXT_FILE_BYTES, 2 * 1024 * 1024);
        assert_eq!(MAX_ALLOWED_ROOTS, 32);
    }
}
