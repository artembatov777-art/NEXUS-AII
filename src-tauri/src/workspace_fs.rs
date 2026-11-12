use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

const MAX_ALLOWED_ROOTS: usize = 32;
const MAX_DIRECTORY_ENTRIES: usize = 500;
const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

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

    fn allowed_root_for(&self, path: &Path) -> Result<PathBuf, String> {
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

#[tauri::command]
pub fn read_workspace_file(path: String, access: State<'_, WorkspaceAccess>) -> Result<String, String> {
    let root = access.allowed_root_for(Path::new(&path))?;
    let canonical = fs::canonicalize(&path).map_err(|e| format!("Could not open file: {e}"))?;
    if !canonical.starts_with(&root) {
        return Err("The requested file is outside the allowed directory.".into());
    }
    let metadata = fs::metadata(&canonical).map_err(|e| format!("Could not inspect file: {e}"))?;
    if !metadata.is_file() { return Err("Only regular files can be opened.".into()); }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err("This file is larger than the 2 MB preview limit.".into());
    }
    let mut file = fs::File::open(&canonical).map_err(|e| format!("Could not read file: {e}"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_TEXT_FILE_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|e| format!("Could not read file: {e}"))?;
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("This file grew beyond the 2 MB preview limit while being read.".into());
    }
    String::from_utf8(bytes).map_err(|_| "This file is not UTF-8 text and cannot be previewed.".into())
}

#[tauri::command]
pub fn write_workspace_file(path: String, content: String, access: State<'_, WorkspaceAccess>) -> Result<(), String> {
    if path.trim().is_empty() || path.len() > 4096 || content.len() as u64 > MAX_TEXT_FILE_BYTES {
        return Err("The file path or content exceeds the allowed size.".into());
    }
    let target = PathBuf::from(&path);
    let parent = target.parent().ok_or_else(|| "The file must be inside an allowed directory.".to_string())?;
    let root = access.ensure_new_path_allowed(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("NEXUS will not overwrite a symbolic link or non-file entry.".into());
        }
        let existing = fs::canonicalize(&target).map_err(|e| format!("Could not resolve existing file: {e}"))?;
        if !existing.starts_with(&root) { return Err("The target file is outside the allowed directory.".into()); }
    }
    let mut file = OpenOptions::new().create(true).truncate(true).write(true).open(&target)
        .map_err(|e| format!("Could not write file: {e}"))?;
    file.write_all(content.as_bytes()).map_err(|e| format!("Could not save file: {e}"))?;
    file.sync_all().map_err(|e| format!("Could not flush file: {e}"))
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
        assert_eq!(results.len(), 2);
        let canonical_root = fs::canonicalize(&root).expect("canonical root");
        assert!(results.iter().all(|entry| Path::new(&entry.path).starts_with(&canonical_root)));
        assert!(results.iter().any(|entry| entry.name == "meeting-notes.md"));
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
