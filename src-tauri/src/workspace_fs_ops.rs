use crate::workspace_fs::{open_regular_file_readonly, WorkspaceAccess};
use crate::workspace_fs_recovery::{RenameEntry, WorkspaceOperationJournal};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;


const MAX_IMAGE_PREVIEW_BYTES: u64 = 4 * 1024 * 1024;

fn image_media_type(path: &Path, bytes: &[u8]) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Some("image/png"),
        "jpg" | "jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => Some("image/jpeg"),
        "gif" if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => Some("image/gif"),
        "webp" if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => Some("image/webp"),
        "bmp" if bytes.starts_with(b"BM") => Some("image/bmp"),
        _ => None,
    }
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0] as u32;
        let second = chunk.get(1).copied().unwrap_or(0) as u32;
        let third = chunk.get(2).copied().unwrap_or(0) as u32;
        let value = (first << 16) | (second << 8) | third;
        output.push(TABLE[((value >> 18) & 0x3f) as usize] as char);
        output.push(TABLE[((value >> 12) & 0x3f) as usize] as char);
        output.push(if chunk.len() > 1 { TABLE[((value >> 6) & 0x3f) as usize] as char } else { '=' });
        output.push(if chunk.len() > 2 { TABLE[(value & 0x3f) as usize] as char } else { '=' });
    }
    output
}

fn read_image_preview(access: &WorkspaceAccess, requested_path: &Path) -> Result<serde_json::Value, String> {
    let parent = requested_path.parent()
        .ok_or_else(|| "The selected image must be inside an approved directory.".to_string())?;
    let root = access.allowed_root_for(parent)?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Could not resolve the selected image directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("The selected image is outside an approved directory.".into());
    }
    let name = requested_path.file_name()
        .ok_or_else(|| "The selected image has no valid name.".to_string())?;
    // Keep the final component unresolved until it is opened with no-follow flags.
    let target = canonical_parent.join(name);
    let link_metadata = fs::symlink_metadata(&target)
        .map_err(|error| format!("Could not inspect the selected image: {error}"))?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err("Image preview is available only for regular files, not symbolic links or special entries.".into());
    }
    let file = open_regular_file_readonly(&target)?;
    let metadata = file.metadata()
        .map_err(|error| format!("Could not inspect the opened image: {error}"))?;
    if metadata.len() > MAX_IMAGE_PREVIEW_BYTES {
        return Err("Image preview supports regular files up to 4 MB.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    use std::io::Read;
    file.take(MAX_IMAGE_PREVIEW_BYTES + 1).read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read the selected image: {error}"))?;
    if bytes.len() as u64 > MAX_IMAGE_PREVIEW_BYTES {
        return Err("Image preview supports files up to 4 MB.".into());
    }
    let media_type = image_media_type(&target, &bytes)
        .ok_or_else(|| "The file extension and image signature do not match a supported PNG, JPEG, GIF, WebP, or BMP image.".to_string())?;
    Ok(serde_json::json!({
        "dataUrl": format!("data:{media_type};base64,{}", encode_base64(&bytes)),
        "mediaType": media_type,
        "sizeBytes": bytes.len()
    }))
}

#[tauri::command]
pub fn read_workspace_image_preview(path: String, access: State<'_, WorkspaceAccess>) -> Result<serde_json::Value, String> {
    if path.trim().is_empty() || path.len() > 4096 {
        return Err("The selected image path is invalid.".into());
    }
    read_image_preview(&access, Path::new(&path))
}

fn validate_entry_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.len() > 255 || name == "." || name == ".."
        || name.chars().any(char::is_control)
        || name.chars().any(|character| ['/', '\\', ':', '*', '?', '"', '<', '>', '|'].contains(&character))
        || name.ends_with('.') || name.ends_with(' ') {
        return Err("Enter a valid file or folder name without path separators or reserved characters.".into());
    }
    let windows_stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(windows_stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" |
        "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" |
        "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    ) {
        return Err("This file or folder name is reserved by Windows.".into());
    }
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err("The new name must be a single path component.".into());
    }
    Ok(())
}

/// Atomically moves an entry only when the destination does not exist.
pub(crate) fn rename_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let source = CString::new(source.as_os_str().as_bytes())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Source path contains a null byte."))?;
        let destination = CString::new(destination.as_os_str().as_bytes())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Destination path contains a null byte."))?;
        let result = unsafe {
            libc::renameat2(libc::AT_FDCWD, source.as_ptr(), libc::AT_FDCWD, destination.as_ptr(), libc::RENAME_NOREPLACE)
        };
        if result == 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
    }
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let source = CString::new(source.as_os_str().as_bytes())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Source path contains a null byte."))?;
        let destination = CString::new(destination.as_os_str().as_bytes())
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "Destination path contains a null byte."))?;
        let result = unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
        if result == 0 { Ok(()) } else { Err(std::io::Error::last_os_error()) }
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let destination: Vec<u16> = destination.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let result = unsafe {
            windows_sys::Win32::Storage::FileSystem::MoveFileW(source.as_ptr(), destination.as_ptr())
        };
        if result == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = (source, destination);
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "Atomic no-replace moves are unsupported on this platform."))
    }
}

fn relocate_entry(
    access: &WorkspaceAccess,
    source_path: &Path,
    destination_directory: &Path,
    requested_name: Option<&str>,
) -> Result<String, String> {
    // Resolve only the parent directory. Canonicalizing the complete source
    // path follows a final symlink and can redirect a rename to a different file.
    let requested_parent = source_path.parent()
        .ok_or_else(|| "The selected entry has no parent directory.".to_string())?;
    let source_root = access.allowed_root_for(requested_parent)?;
    let canonical_source_parent = fs::canonicalize(requested_parent)
        .map_err(|error| format!("Could not resolve the selected entry's directory: {error}"))?;
    if !canonical_source_parent.starts_with(&source_root) {
        return Err("The selected entry is outside an approved directory.".into());
    }
    let source_name = source_path.file_name()
        .ok_or_else(|| "The selected entry has no valid name.".to_string())?;
    let source = canonical_source_parent.join(source_name);
    let source_metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("Could not inspect the selected entry: {error}"))?;
    if source_metadata.file_type().is_symlink() || (!source_metadata.is_file() && !source_metadata.is_dir()) {
        return Err("NEXUS can move only regular files and directories, not symbolic links or special entries.".into());
    }
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
    match fs::symlink_metadata(&target) {
        Ok(_) => return Err("A file or folder with that name already exists at the destination.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Could not verify the destination path: {error}")),
    }
    rename_no_replace(&source, &target)
        .map_err(|error| format!("Could not move the entry without replacing an existing destination. The source and destination may be on different volumes or the entry may be in use: {error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn rename_workspace_entry(
    path: String,
    new_name: String,
    access: State<'_, WorkspaceAccess>,
    journal: State<'_, WorkspaceOperationJournal>,
) -> Result<String, String> {
    let _operation_guard = journal.lock_operation()?;
    journal.ensure_ready()?;
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
    journal: State<'_, WorkspaceOperationJournal>,
) -> Result<String, String> {
    let _operation_guard = journal.lock_operation()?;
    journal.ensure_ready()?;
    if path.trim().is_empty() || path.len() > 4096
        || destination_directory.trim().is_empty() || destination_directory.len() > 4096 {
        return Err("The source or destination path is invalid.".into());
    }
    relocate_entry(&access, Path::new(&path), Path::new(&destination_directory), None)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMoveRequest {
    path: String,
    destination_directory: String,
}

fn move_workspace_entries_batch_inner(
    entries: Vec<WorkspaceMoveRequest>,
    access: &WorkspaceAccess,
    journal: Option<&WorkspaceOperationJournal>,
) -> Result<Vec<String>, String> {
    if let Some(journal) = journal { journal.ensure_ready()?; }
    if entries.is_empty() || entries.len() > 100 {
        return Err("Select between 1 and 100 files for batch move.".into());
    }

    let mut seen_sources = HashSet::new();
    let mut seen_targets = HashSet::new();
    let mut common_root: Option<PathBuf> = None;
    let mut plans: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(entries.len());

    for entry in entries {
        if entry.path.trim().is_empty() || entry.path.len() > 4096
            || entry.destination_directory.trim().is_empty() || entry.destination_directory.len() > 4096 {
            return Err("A selected source or destination path is invalid.".into());
        }
        let requested_source = PathBuf::from(&entry.path);
        let requested_parent = requested_source.parent()
            .ok_or_else(|| "A selected file has no parent directory.".to_string())?;
        let source_root = access.allowed_root_for(requested_parent)?;
        let canonical_source_parent = fs::canonicalize(requested_parent)
            .map_err(|error| format!("Could not resolve a selected file's directory: {error}"))?;
        if !canonical_source_parent.starts_with(&source_root) {
            return Err("A selected file is outside an approved directory.".into());
        }
        let source_name = requested_source.file_name()
            .ok_or_else(|| "A selected file has no valid name.".to_string())?;
        let source = canonical_source_parent.join(source_name);
        let metadata = fs::symlink_metadata(&source)
            .map_err(|error| format!("Could not inspect a selected file: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Batch move supports regular files only; folders, symbolic links, and special entries are excluded.".into());
        }
        if !seen_sources.insert(source.clone()) {
            return Err("The same file was selected more than once.".into());
        }

        let requested_destination = Path::new(&entry.destination_directory);
        let destination_root = access.allowed_root_for(requested_destination)?;
        let destination = fs::canonicalize(requested_destination)
            .map_err(|error| format!("Could not resolve the destination directory: {error}"))?;
        if source_root != destination_root || !destination.is_dir() || !destination.starts_with(&source_root) {
            return Err("Every destination must be an existing directory inside the same approved root as its source file.".into());
        }
        if let Some(expected_root) = &common_root {
            if expected_root != &source_root {
                return Err("Batch move must stay inside one approved directory.".into());
            }
        } else {
            common_root = Some(source_root.clone());
        }

        let target = destination.join(source_name);
        if target == source {
            return Err("A selected file is already in its destination directory.".into());
        }
        let target_key = target.to_string_lossy().to_lowercase();
        if !seen_targets.insert(target_key) {
            return Err("The selected files create duplicate destination paths.".into());
        }
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(format!("A file or folder already exists at destination: {}", target.file_name().and_then(|value| value.to_str()).unwrap_or("selected file"))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not verify a destination path: {error}")),
        }
        plans.push((source, destination));
    }

    let journal_id = if let Some(journal) = journal {
        let entries = plans.iter().map(|(source, destination)| RenameEntry {
            source: source.clone(),
            destination: destination.join(source.file_name().expect("validated source has a file name")),
        }).collect::<Vec<_>>();
        Some(journal.begin(&entries)?)
    } else {
        None
    };

    let mut moved: Vec<(String, PathBuf)> = Vec::with_capacity(plans.len());
    for (source, destination) in plans {
        let original_parent = source.parent().unwrap_or_else(|| Path::new("")).to_path_buf();
        match relocate_entry(access, &source, &destination, None) {
            Ok(next_path) => moved.push((next_path, original_parent)),
            Err(cause) => {
                let mut rollback_failures = Vec::new();
                for (moved_path, original_parent) in moved.iter().rev() {
                    if relocate_entry(access, Path::new(moved_path), original_parent, None).is_err() {
                        rollback_failures.push(moved_path.clone());
                    }
                }
                if rollback_failures.is_empty() {
                    if let (Some(journal), Some(operation_id)) = (journal, journal_id.as_deref()) {
                        journal.complete(operation_id).map_err(|error| format!("Batch move failed and files were restored, but its recovery record remains: {error}. Original error: {cause}"))?;
                    }
                    return Err(format!("Batch move failed; earlier files were restored. {cause}"));
                }
                return Err(format!(
                    "Batch move failed and rollback was incomplete. Review these files manually: {}. Original error: {cause}",
                    rollback_failures.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
                ));
            }
        }
    }
    if let (Some(journal), Some(operation_id)) = (journal, journal_id.as_deref()) {
        journal.complete(operation_id)?;
    }
    Ok(moved.into_iter().map(|(path, _)| path).collect())
}

#[tauri::command]
pub fn move_workspace_entries_batch(
    entries: Vec<WorkspaceMoveRequest>,
    access: State<'_, WorkspaceAccess>,
    journal: State<'_, WorkspaceOperationJournal>,
) -> Result<Vec<String>, String> {
    let _operation_guard = journal.lock_operation()?;
    move_workspace_entries_batch_inner(entries, &access, Some(&journal))
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRenameRequest {
    path: String,
    new_name: String,
}

fn rename_workspace_entries_batch_inner(
    entries: Vec<WorkspaceRenameRequest>,
    access: &WorkspaceAccess,
    journal: Option<&WorkspaceOperationJournal>,
) -> Result<Vec<String>, String> {
    if let Some(journal) = journal { journal.ensure_ready()?; }
    if entries.is_empty() || entries.len() > 100 {
        return Err("Select between 1 and 100 files for batch rename.".into());
    }

    let mut seen_sources = HashSet::new();
    let mut seen_targets = HashSet::new();
    let mut common_parent: Option<PathBuf> = None;
    let mut plans: Vec<(PathBuf, PathBuf, String, String)> = Vec::with_capacity(entries.len());

    // Validate the complete batch before changing any file. Resolve each
    // parent, never the final component, so a symlink cannot redirect the plan.
    for entry in entries {
        if entry.path.trim().is_empty() || entry.path.len() > 4096 {
            return Err("A selected file path is invalid.".into());
        }
        validate_entry_name(&entry.new_name)?;
        let requested_path = PathBuf::from(&entry.path);
        let requested_parent = requested_path.parent()
            .ok_or_else(|| "A selected file has no parent directory.".to_string())?;
        let source_root = access.allowed_root_for(requested_parent)?;
        let canonical_parent = fs::canonicalize(requested_parent)
            .map_err(|error| format!("Could not resolve a selected file's parent directory: {error}"))?;
        if !canonical_parent.starts_with(&source_root) {
            return Err("All renamed files must remain inside an approved directory.".into());
        }
        let source_name = requested_path.file_name()
            .ok_or_else(|| "A selected file has no valid name.".to_string())?;
        let source = canonical_parent.join(source_name);
        let metadata = fs::symlink_metadata(&source)
            .map_err(|error| format!("Could not inspect a selected file: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Batch rename supports regular files only; folders, symbolic links, and special entries are excluded.".into());
        }
        if !seen_sources.insert(source.clone()) {
            return Err("The same file was selected more than once.".into());
        }
        if let Some(expected_parent) = &common_parent {
            if expected_parent != &canonical_parent {
                return Err("Batch rename is limited to files in the same directory.".into());
            }
        } else {
            common_parent = Some(canonical_parent.clone());
        }
        let target = canonical_parent.join(&entry.new_name);
        if target == source {
            return Err("The rename pattern leaves at least one file name unchanged.".into());
        }
        let target_key = target.to_string_lossy().to_lowercase();
        if !seen_targets.insert(target_key) {
            return Err("The rename pattern creates duplicate destination names.".into());
        }
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(format!("A file or folder already exists at destination: {}", entry.new_name)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not verify a destination file name: {error}")),
        }
        let original_name = source.file_name()
            .ok_or_else(|| "A selected file has no valid name.".to_string())?
            .to_string_lossy().into_owned();
        plans.push((source, canonical_parent, entry.new_name, original_name));
    }

    let journal_id = if let Some(journal) = journal {
        let entries = plans.iter().map(|(source, parent, new_name, _)| RenameEntry {
            source: source.clone(),
            destination: parent.join(new_name),
        }).collect::<Vec<_>>();
        Some(journal.begin(&entries)?)
    } else {
        None
    };

    let mut renamed: Vec<(String, PathBuf, String)> = Vec::with_capacity(plans.len());
    for (source, parent, new_name, original_name) in plans {
        match relocate_entry(access, &source, &parent, Some(&new_name)) {
            Ok(next_path) => renamed.push((next_path, parent, original_name)),
            Err(cause) => {
                let mut rollback_failures = Vec::new();
                for (renamed_path, original_parent, original_name) in renamed.iter().rev() {
                    if relocate_entry(access, Path::new(renamed_path), original_parent, Some(original_name)).is_err() {
                        rollback_failures.push(renamed_path.clone());
                    }
                }
                if rollback_failures.is_empty() {
                    if let (Some(journal), Some(operation_id)) = (journal, journal_id.as_deref()) {
                        journal.complete(operation_id).map_err(|error| format!("Batch rename failed and files were restored, but its recovery record remains: {error}. Original error: {cause}"))?;
                    }
                    return Err(format!("Batch rename failed; earlier names were restored. {cause}"));
                }
                return Err(format!(
                    "Batch rename failed and rollback was incomplete. Review these files manually: {}. Original error: {cause}",
                    rollback_failures.iter().take(4).cloned().collect::<Vec<_>>().join(", ")
                ));
            }
        }
    }
    if let (Some(journal), Some(operation_id)) = (journal, journal_id.as_deref()) {
        journal.complete(operation_id)?;
    }
    Ok(renamed.into_iter().map(|(path, _, _)| path).collect())
}

#[tauri::command]
pub fn rename_workspace_entries_batch(
    entries: Vec<WorkspaceRenameRequest>,
    access: State<'_, WorkspaceAccess>,
    journal: State<'_, WorkspaceOperationJournal>,
) -> Result<Vec<String>, String> {
    let _operation_guard = journal.lock_operation()?;
    rename_workspace_entries_batch_inner(entries, &access, Some(&journal))
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
    fn no_replace_move_preserves_an_existing_file_destination() {
        let (base, root, _access) = fixture();
        let source = root.join("source.txt");
        let destination = root.join("destination.txt");
        fs::write(&source, "source contents").expect("write source");
        fs::write(&destination, "destination contents").expect("write destination");

        let result = rename_no_replace(&source, &destination);
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&source).expect("read source"), "source contents");
        assert_eq!(fs::read_to_string(&destination).expect("read destination"), "destination contents");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn no_replace_move_preserves_an_existing_directory_destination() {
        let (base, root, _access) = fixture();
        let source = root.join("source");
        let destination = root.join("destination");
        fs::create_dir(&source).expect("create source directory");
        fs::create_dir(&destination).expect("create destination directory");
        fs::write(source.join("source.txt"), "source").expect("write source child");
        fs::write(destination.join("destination.txt"), "destination").expect("write destination child");

        let result = rename_no_replace(&source, &destination);
        assert!(result.is_err());
        assert!(source.join("source.txt").exists());
        assert!(destination.join("destination.txt").exists());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn image_preview_accepts_only_scoped_raster_files_with_matching_signatures() {
        let (base, root, access) = fixture();
        let png = root.join("preview.png");
        fs::write(&png, b"\x89PNG\r\n\x1a\nfixture").expect("write PNG fixture");
        let result = read_image_preview(&access, &png).expect("read approved PNG");
        assert_eq!(result["mediaType"], "image/png");
        assert_eq!(result["dataUrl"], format!("data:image/png;base64,{}", encode_base64(b"\x89PNG\r\n\x1a\nfixture")));

        let disguised = root.join("notes.txt");
        fs::write(&disguised, b"\x89PNG\r\n\x1a\nfixture").expect("write disguised image");
        assert!(read_image_preview(&access, &disguised).is_err());

        let svg = root.join("active.svg");
        fs::write(&svg, b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").expect("write SVG");
        assert!(read_image_preview(&access, &svg).is_err());

        let outside = base.join("outside.png");
        fs::write(&outside, b"\x89PNG\r\n\x1a\nfixture").expect("write outside image");
        assert!(read_image_preview(&access, &outside).is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn image_preview_rejects_oversized_files_and_base64_padding_is_correct() {
        let (base, root, access) = fixture();
        let oversized = root.join("large.png");
        let mut content = b"\x89PNG\r\n\x1a\n".to_vec();
        content.resize((MAX_IMAGE_PREVIEW_BYTES + 1) as usize, 0);
        fs::write(&oversized, content).expect("write oversized image");
        assert!(read_image_preview(&access, &oversized).unwrap_err().contains("4 MB"));
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        fs::remove_dir_all(base).expect("cleanup");
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

    #[cfg(unix)]
    #[test]
    fn move_and_batch_rename_reject_final_component_symlinks() {
        use std::os::unix::fs::symlink;
        let (base, root, access) = fixture();
        let outside = base.join("outside.txt");
        let link = root.join("linked.txt");
        fs::write(&outside, "outside data").expect("create outside target");
        symlink(&outside, &link).expect("create selected symlink");

        assert!(relocate_entry(&access, &link, &root, Some("moved.txt")).is_err());
        assert!(rename_workspace_entries_batch_inner(vec![
            WorkspaceRenameRequest { path: link.to_string_lossy().into_owned(), new_name: "renamed.txt".into() }
        ], &access, None).is_err());
        assert!(link.is_symlink());
        assert_eq!(fs::read_to_string(&outside).expect("read outside target"), "outside data");
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
    fn batch_rename_preserves_extensions_and_file_contents() {
        let (base, root, access) = fixture();
        let first = root.join("one.txt");
        let second = root.join("two.md");
        fs::write(&first, "first contents").expect("create first file");
        fs::write(&second, "second contents").expect("create second file");
        let result = rename_workspace_entries_batch_inner(vec![
            WorkspaceRenameRequest { path: first.to_string_lossy().into_owned(), new_name: "archived-one.txt".into() },
            WorkspaceRenameRequest { path: second.to_string_lossy().into_owned(), new_name: "archived-two.md".into() },
        ], &access, None).expect("rename selected files");
        assert_eq!(result.len(), 2);
        assert_eq!(fs::read_to_string(root.join("archived-one.txt")).unwrap(), "first contents");
        assert_eq!(fs::read_to_string(root.join("archived-two.md")).unwrap(), "second contents");
        assert!(!first.exists() && !second.exists());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn batch_move_persists_and_clears_its_recovery_journal() {
        let (base, root, access) = fixture();
        let journal = WorkspaceOperationJournal::open(&base.join("journal.sqlite")).expect("open operation journal");
        let destination = root.join("Archive");
        fs::create_dir(&destination).expect("create destination");
        let first = root.join("one.txt");
        let second = root.join("two.md");
        fs::write(&first, "first contents").expect("create first file");
        fs::write(&second, "second contents").expect("create second file");
        let result = move_workspace_entries_batch_inner(vec![
            WorkspaceMoveRequest { path: first.to_string_lossy().into_owned(), destination_directory: destination.to_string_lossy().into_owned() },
            WorkspaceMoveRequest { path: second.to_string_lossy().into_owned(), destination_directory: destination.to_string_lossy().into_owned() },
        ], &access, Some(&journal)).expect("journalled batch move");
        assert_eq!(result.len(), 2);
        assert_eq!(fs::read_to_string(destination.join("one.txt")).unwrap(), "first contents");
        assert_eq!(fs::read_to_string(destination.join("two.md")).unwrap(), "second contents");
        assert!(!first.exists() && !second.exists());
        assert!(journal.recovery_status().expect("recovery status").is_none());
        drop(journal);
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn batch_rename_persists_and_clears_its_recovery_journal() {
        let (base, root, access) = fixture();
        let journal = WorkspaceOperationJournal::open(&base.join("journal.sqlite")).expect("open operation journal");
        let first = root.join("one.txt");
        let second = root.join("two.md");
        fs::write(&first, "first contents").expect("create first file");
        fs::write(&second, "second contents").expect("create second file");
        let result = rename_workspace_entries_batch_inner(vec![
            WorkspaceRenameRequest { path: first.to_string_lossy().into_owned(), new_name: "archived-one.txt".into() },
            WorkspaceRenameRequest { path: second.to_string_lossy().into_owned(), new_name: "archived-two.md".into() },
        ], &access, Some(&journal)).expect("journalled batch rename");
        assert_eq!(result.len(), 2);
        assert_eq!(fs::read_to_string(root.join("archived-one.txt")).unwrap(), "first contents");
        assert_eq!(fs::read_to_string(root.join("archived-two.md")).unwrap(), "second contents");
        assert!(journal.recovery_status().expect("recovery status").is_none());
        drop(journal);
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn batch_rename_preflights_conflicts_without_changing_any_file() {
        let (base, root, access) = fixture();
        let first = root.join("one.txt");
        let second = root.join("two.txt");
        fs::write(&first, "first").expect("create first");
        fs::write(&second, "second").expect("create second");
        fs::write(root.join("taken.txt"), "existing").expect("create conflict");
        let result = rename_workspace_entries_batch_inner(vec![
            WorkspaceRenameRequest { path: first.to_string_lossy().into_owned(), new_name: "renamed.txt".into() },
            WorkspaceRenameRequest { path: second.to_string_lossy().into_owned(), new_name: "taken.txt".into() },
        ], &access, None);
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&first).unwrap(), "first");
        assert_eq!(fs::read_to_string(&second).unwrap(), "second");
        assert_eq!(fs::read_to_string(root.join("taken.txt")).unwrap(), "existing");
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn batch_rename_rejects_duplicate_names_mixed_directories_and_outside_paths() {
        let (base, root, access) = fixture();
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("create nested");
        let first = root.join("one.txt");
        let second = nested.join("two.txt");
        fs::write(&first, "one").expect("create first");
        fs::write(&second, "two").expect("create second");
        let duplicate = rename_workspace_entries_batch_inner(vec![
            WorkspaceRenameRequest { path: first.to_string_lossy().into_owned(), new_name: "same.txt".into() },
            WorkspaceRenameRequest { path: first.to_string_lossy().into_owned(), new_name: "other.txt".into() },
        ], &access, None);
        assert!(duplicate.is_err());
        let mixed = rename_workspace_entries_batch_inner(vec![
            WorkspaceRenameRequest { path: first.to_string_lossy().into_owned(), new_name: "one-new.txt".into() },
            WorkspaceRenameRequest { path: second.to_string_lossy().into_owned(), new_name: "two-new.txt".into() },
        ], &access, None);
        assert!(mixed.is_err());
        let outside = base.join("outside.txt");
        fs::write(&outside, "outside").expect("create outside");
        let escaped = rename_workspace_entries_batch_inner(vec![
            WorkspaceRenameRequest { path: outside.to_string_lossy().into_owned(), new_name: "moved.txt".into() },
        ], &access, None);
        assert!(escaped.is_err());
        assert!(first.exists() && second.exists() && outside.exists());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn rename_rejects_invalid_names() {
        for name in ["", ".", "..", "../escape", "folder/name", "bad:name", "trailing.",
            "CON", "con.txt", "nul.log", "PRN", "AUX", "COM1", "LPT9"] {
            assert!(validate_entry_name(name).is_err(), "accepted invalid name: {name}");
        }
        assert!(validate_entry_name("report-final.txt").is_ok());
        assert!(validate_entry_name("conifer.txt").is_ok());
    }
}
