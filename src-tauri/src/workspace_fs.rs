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
        fs::rename(&temporary, &self.persistence_path)
            .map_err(|e| format!("Could not finalize workspace permissions: {e}"))
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
    modified_at_ms: Option<u128>,
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
        let modified_at_ms = metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis());
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
    file.read_to_end(&mut bytes).map_err(|e| format!("Could not read file: {e}"))?;
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
    fn workspace_entry_limit_is_bounded() {
        assert_eq!(MAX_DIRECTORY_ENTRIES, 500);
        assert_eq!(MAX_TEXT_FILE_BYTES, 2 * 1024 * 1024);
        assert_eq!(MAX_ALLOWED_ROOTS, 32);
    }
}
