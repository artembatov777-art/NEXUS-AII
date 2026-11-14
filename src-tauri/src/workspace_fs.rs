use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const MAX_ALLOWED_ROOTS: usize = 32;
const MAX_DIRECTORY_ENTRIES: usize = 500;

const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Refuse hard-linked files: a second directory entry may expose the same inode
/// outside the owner-approved workspace, even when the selected path is inside it.
fn ensure_no_external_hard_links(file: &fs::File) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file.metadata()
            .map_err(|_| "NEXUS could not verify whether the file has external hard links.")?;
        if metadata.nlink() > 1 {
            return Err("NEXUS will not access a hard-linked file because another path may expose the same data.".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
        let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        let queried = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut information) };
        if queried == 0 {
            return Err("NEXUS could not verify whether the file has external hard links.".into());
        }
        if information.nNumberOfLinks > 1 {
            return Err("NEXUS will not access a hard-linked file because another path may expose the same data.".into());
        }
    }
    Ok(())
}

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
    if !metadata.is_file() || metadata.file_type().is_symlink() {
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
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("NEXUS can edit regular files only, not links or special entries.".into());
    }
    ensure_no_external_hard_links(&file)?;
    Ok(file)
}

pub struct WorkspaceAccess {
    roots: Mutex<Vec<PathBuf>>,
    persistence_path: PathBuf,
}

impl WorkspaceAccess {
    pub fn load(persistence_path: PathBuf) -> Self {
        let roots = fs::read_to_string(&persistence_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| fs::canonicalize(value).ok())
            .filter(|path| path.is_dir())
            .collect();
        Self { roots: Mutex::new(roots), persistence_path }
    }

    fn persist(&self, roots: &[PathBuf]) -> Result<(), String> {
        let values: Vec<String> = roots.iter().map(|path| path.to_string_lossy().into_owned()).collect();
        let serialized = serde_json::to_vec_pretty(&values).map_err(|e| e.to_string())?;
        if let Some(parent) = self.persistence_path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Could not create workspace settings directory: {e}"))?;
        }
        let temporary = self.persistence_path.with_extension("json.tmp");
        let mut file = OpenOptions::new().create(true).truncate(true).write(true).open(&temporary)
            .map_err(|e| format!("Could not write workspace permissions: {e}"))?;
        file.write_all(&serialized).map_err(|e| format!("Could not save workspace permissions: {e}"))?;
        file.sync_all().map_err(|e| format!("Could not flush workspace permissions: {e}"))?;
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

    pub(crate) fn allowed_root_for(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = fs::canonicalize(path).map_err(|e| format!("Could not resolve the requested path: {e}"))?;
        let roots = self.roots.lock().map_err(|_| "Workspace permission lock is unavailable.")?;
        roots.iter().find(|root| canonical.starts_with(root)).cloned()
            .ok_or_else(|| "This path is outside the directories explicitly allowed in NEXUS.".to_string())
    }

    fn ensure_new_path_allowed(&self, parent: &Path) -> Result<PathBuf, String> {
        self.allowed_root_for(parent)
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

#[tauri::command]
pub fn list_workspace_entries(path: String, access: State<'_, WorkspaceAccess>) -> Result<Vec<WorkspaceEntry>, String> {
    let root = access.allowed_root_for(Path::new(&path))?;
    let directory = fs::canonicalize(&path).map_err(|e| format!("Could not open directory: {e}"))?;
    if !directory.is_dir() || !directory.starts_with(&root) {
        return Err("The requested location is not an allowed directory.".into());
    }
    let mut entries = Vec::new();
    let iterator = fs::read_dir(&directory).map_err(|e| format!("Could not read directory: {e}"))?;
    for item in iterator.take(MAX_DIRECTORY_ENTRIES) {
        let item = item.map_err(|e| format!("Could not inspect a directory entry: {e}"))?;
        let entry_path = item.path();
        let metadata = match fs::symlink_metadata(&entry_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() { continue; }
        let canonical = match fs::canonicalize(&entry_path) {
            Ok(value) if value.starts_with(&root) => value,
            _ => continue,
        };
        let metadata = fs::metadata(&canonical).map_err(|e| format!("Could not inspect {}: {e}", item.file_name().to_string_lossy()))?;
        let kind = if metadata.is_dir() { "directory" } else if metadata.is_file() { "file" } else { "other" };
        let modified_at_ms = metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis().min(u64::MAX as u128) as u64);
        entries.push(WorkspaceEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: canonical.to_string_lossy().into_owned(),
            kind: kind.into(),
            size_bytes: metadata.len(),
            modified_at_ms,
        });
    }
    entries.sort_by(|a, b| (a.kind != "directory").cmp(&(b.kind != "directory")).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

const MAX_SEARCH_VISITED_ENTRIES: usize = 5_000;
const MAX_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_DEPTH: usize = 12;

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
            if link_metadata.file_type().is_symlink() { continue; }
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

#[tauri::command]
pub fn search_workspace_entries(path: String, query: String, access: State<'_, WorkspaceAccess>) -> Result<Vec<WorkspaceEntry>, String> {
    let root = access.allowed_root_for(Path::new(&path))?;
    search_workspace_entries_in(&root, Path::new(&path), &query)
}

fn read_workspace_file_inner(path: &str, access: &WorkspaceAccess) -> Result<String, String> {
    if path.trim().is_empty() || path.len() > 4096 {
        return Err("The selected file path is invalid.".into());
    }
    let requested = Path::new(path);
    let parent = requested.parent()
        .ok_or_else(|| "The file must be inside an approved directory.".to_string())?;
    let root = access.allowed_root_for(parent)?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Could not resolve the selected file's directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("The requested file is outside the allowed directory.".into());
    }
    let name = requested.file_name()
        .ok_or_else(|| "The selected file has no valid name.".to_string())?;
    // Resolve only the parent. Canonicalizing the complete path would follow
    // a final-component symlink before O_NOFOLLOW/OPEN_REPARSE_POINT can reject it.
    let target = canonical_parent.join(name);
    let file = open_regular_file_readonly(&target)?;
    let metadata = file.metadata().map_err(|e| format!("Could not inspect opened file: {e}"))?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err("This file is larger than the 2 MB preview limit.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_TEXT_FILE_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|e| format!("Could not read file: {e}"))?;
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("This file grew beyond the 2 MB preview limit while being read.".into());
    }
    String::from_utf8(bytes).map_err(|_| "This file is not UTF-8 text and cannot be previewed.".into())
}

#[tauri::command]
pub fn read_workspace_file(path: String, access: State<'_, WorkspaceAccess>) -> Result<String, String> {
    read_workspace_file_inner(&path, &access)
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
    let parent = requested.parent()
        .ok_or_else(|| "The file must be inside an allowed directory.".to_string())?;
    let root = access.ensure_new_path_allowed(parent)?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Could not resolve the target directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("The target directory is outside the allowed workspace.".into());
    }
    let name = requested.file_name()
        .ok_or_else(|| "The file must have a valid name.".to_string())?;
    let target = canonical_parent.join(name);

    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if expected_content.is_none() {
                return Err("A file or folder already exists at this path. Choose a different name instead of overwriting it.".into());
            }
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("NEXUS will not overwrite a symbolic link or non-file entry.".into());
            }
            let existing = fs::canonicalize(&target)
                .map_err(|error| format!("Could not resolve existing file: {error}"))?;
            if !existing.starts_with(&root) {
                return Err("The target file is outside the allowed directory.".into());
            }

            // Open once without following a final symlink. Compare and replace
            // through the same handle so a path swap cannot redirect the write.
            let mut file = open_regular_file_readwrite(&target)
                .map_err(|error| {
                    if error.contains("hard-linked") {
                        error
                    } else {
                        "The file changed or is no longer safely readable. Reload it before saving.".to_string()
                    }
                })?;
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
            file.set_len(0).map_err(|error| format!("Could not truncate the approved file: {error}"))?;
            file.seek(SeekFrom::Start(0)).map_err(|error| format!("Could not seek in the approved file: {error}"))?;
            file.write_all(content.as_bytes()).map_err(|error| format!("Could not save file: {error}"))?;
            file.sync_all().map_err(|error| format!("Could not flush file: {error}"))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if expected_content.is_some() {
                return Err("File was removed or moved outside NEXUS since it was opened. Your draft is preserved.".into());
            }
            // create_new is atomic and refuses to replace a path that appeared
            // after the preflight check.
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
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
            let mut file = options.open(&target)
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

#[tauri::command]
pub fn create_workspace_directory(path: String, access: State<'_, WorkspaceAccess>) -> Result<(), String> {
    if path.trim().is_empty() || path.len() > 4096 { return Err("Enter a valid directory path.".into()); }
    let target = PathBuf::from(path);
    let parent = target.parent().ok_or_else(|| "The new directory must be inside an allowed directory.".to_string())?;
    let root = access.ensure_new_path_allowed(parent)?;
    if target.exists() { return Err("A file or directory already exists at that path.".into()); }
    if !target.starts_with(&root) { return Err("The new directory must be inside an allowed directory.".into()); }
    fs::create_dir(&target).map_err(|e| format!("Could not create directory: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn workspace_file_reads_reject_final_component_symlinks_even_when_target_is_approved() {
        use std::os::unix::fs::symlink;
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

    #[test]
    fn workspace_entry_limit_is_bounded() {
        assert_eq!(MAX_DIRECTORY_ENTRIES, 500);
        assert_eq!(MAX_TEXT_FILE_BYTES, 2 * 1024 * 1024);
        assert_eq!(MAX_ALLOWED_ROOTS, 32);
    }
}
