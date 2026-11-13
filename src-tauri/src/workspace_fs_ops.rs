use crate::workspace_fs::WorkspaceAccess;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

fn validate_entry_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.len() > 255 || name == "." || name == ".."
        || name.chars().any(char::is_control)
        || name.chars().any(|character| ['/', '\\', ':', '*', '?', '"', '<', '>', '|'].contains(&character))
        || name.ends_with('.') || name.ends_with(' ') {
        return Err("Enter a valid file or folder name without path separators or reserved characters.".into());
    }
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err("The new name must be a single path component.".into());
    }
    Ok(())
}

fn relocate_entry(
    access: &WorkspaceAccess,
    source_path: &Path,
    destination_directory: &Path,
    requested_name: Option<&str>,
) -> Result<String, String> {
    let source_metadata = fs::symlink_metadata(source_path)
        .map_err(|error| format!("Could not inspect the selected entry: {error}"))?;
    if source_metadata.file_type().is_symlink() || (!source_metadata.is_file() && !source_metadata.is_dir()) {
        return Err("NEXUS can move only regular files and directories, not symbolic links or special entries.".into());
    }

    let source_root = access.allowed_root_for(source_path)?;
    let source = fs::canonicalize(source_path)
        .map_err(|error| format!("Could not resolve the selected entry: {error}"))?;
    if source == source_root || !source.starts_with(&source_root) {
        return Err("An approved root directory itself cannot be renamed or moved.".into());
    }

    let destination_root = access.allowed_root_for(destination_directory)?;
    if destination_root != source_root {
        return Err("Move and rename operations must stay inside the same approved directory.".into());
    }
    let destination = fs::canonicalize(destination_directory)
        .map_err(|error| format!("Could not resolve the destination directory: {error}"))?;
    if !destination.is_dir() || !destination.starts_with(&source_root) {
        return Err("The destination must be an existing directory inside the same approved root.".into());
    }
    if source_metadata.is_dir() && destination.starts_with(&source) {
        return Err("A directory cannot be moved into itself or one of its subdirectories.".into());
    }

    let name = match requested_name {
        Some(value) => {
            validate_entry_name(value)?;
            value.to_string()
        }
        None => source.file_name()
            .ok_or_else(|| "The selected entry has no valid name.".to_string())?
            .to_string_lossy().into_owned()
    };
    let target = destination.join(name);
    if target == source {
        return Err("The selected entry is already at that location.".into());
    }
    if fs::symlink_metadata(&target).is_ok() {
        return Err("A file or folder with that name already exists at the destination.".into());
    }
    fs::rename(&source, &target)
        .map_err(|error| format!("Could not move the entry. The source and destination may be on different volumes or the entry may be in use: {error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn rename_workspace_entry(
    path: String,
    new_name: String,
    access: State<'_, WorkspaceAccess>,
) -> Result<String, String> {
    if path.trim().is_empty() || path.len() > 4096 {
        return Err("The selected path is invalid.".into());
    }
    let source = PathBuf::from(path);
    let parent = source.parent().ok_or_else(|| "The selected entry has no parent directory.".to_string())?;
    relocate_entry(&access, &source, parent, Some(&new_name))
}

#[tauri::command]
pub fn move_workspace_entry(
    path: String,
    destination_directory: String,
    access: State<'_, WorkspaceAccess>,
) -> Result<String, String> {
    if path.trim().is_empty() || path.len() > 4096
        || destination_directory.trim().is_empty() || destination_directory.len() > 4096 {
        return Err("The source or destination path is invalid.".into());
    }
    relocate_entry(&access, Path::new(&path), Path::new(&destination_directory), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (PathBuf, PathBuf, WorkspaceAccess) {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-ops-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let permissions = base.join("permissions.json");
        fs::write(&permissions, serde_json::to_vec(&vec![root.to_string_lossy().into_owned()]).expect("serialize roots"))
            .expect("write permissions");
        let access = WorkspaceAccess::load(permissions);
        (base, root, access)
    }

    #[test]
    fn rename_moves_entry_to_new_name_without_overwriting() {
        let (base, root, access) = fixture();
        let source = root.join("draft.txt");
        fs::write(&source, "keep this").expect("create source");
        let result = relocate_entry(&access, &source, &root, Some("final.txt")).expect("rename entry");
        assert_eq!(Path::new(&result).file_name().unwrap(), "final.txt");
        assert!(!source.exists());
        assert_eq!(fs::read_to_string(result).unwrap(), "keep this");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn move_keeps_original_name_and_rejects_existing_destination() {
        let (base, root, access) = fixture();
        let source_dir = root.join("source");
        let destination = root.join("destination");
        fs::create_dir_all(&source_dir).expect("create source folder");
        fs::create_dir_all(&destination).expect("create destination folder");
        let source = source_dir.join("notes.txt");
        fs::write(&source, "notes").expect("create source file");
        let moved = relocate_entry(&access, &source, &destination, None).expect("move entry");
        assert_eq!(Path::new(&moved).file_name().unwrap(), "notes.txt");
        fs::write(source_dir.join("duplicate.txt"), "one").expect("create duplicate source");
        fs::write(destination.join("duplicate.txt"), "two").expect("create duplicate target");
        assert!(relocate_entry(&access, &source_dir.join("duplicate.txt"), &destination, None).is_err());
        assert_eq!(fs::read_to_string(destination.join("duplicate.txt")).unwrap(), "two");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn operations_reject_root_escape_root_rename_and_directory_cycles() {
        let (base, root, access) = fixture();
        let outside = base.join("outside");
        fs::create_dir_all(&outside).expect("create outside");
        let folder = root.join("folder");
        let child = folder.join("child");
        fs::create_dir_all(&child).expect("create nested directory");
        assert!(relocate_entry(&access, &folder, &child, None).is_err());
        assert!(relocate_entry(&access, &root, &root, Some("renamed")).is_err());
        assert!(relocate_entry(&access, &folder, &outside, None).is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn rename_rejects_invalid_names() {
        for name in ["", ".", "..", "../escape", "folder/name", "bad:name", "trailing."] {
            assert!(validate_entry_name(name).is_err(), "accepted invalid name: {name}");
        }
        assert!(validate_entry_name("report-final.txt").is_ok());
    }
}
