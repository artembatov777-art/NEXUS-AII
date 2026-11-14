use crate::workspace_fs::WorkspaceAccess;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const JOURNAL_VERSION: u32 = 1;
const MAX_JOURNALED_OPERATIONS: usize = 8;
const MAX_JOURNALED_ENTRIES: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameEntry {
    pub(crate) source: PathBuf,
    pub(crate) destination: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameJournal {
    version: u32,
    entries: Vec<RenameEntry>,
}

pub struct WorkspaceOperationJournal {
    connection: Mutex<Connection>,
    recovery_error: Mutex<Option<String>>,
}

impl WorkspaceOperationJournal {
    pub fn open(database_path: &Path) -> Result<Self, String> {
        let connection = Connection::open(database_path)
            .map_err(|error| format!("Could not open the workspace operation journal: {error}"))?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_operation_journal (
                operation_id TEXT PRIMARY KEY NOT NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );"
        ).map_err(|error| format!("Could not initialize the workspace operation journal: {error}"))?;
        Ok(Self {
            connection: Mutex::new(connection),
            recovery_error: Mutex::new(None),
        })
    }

    pub(crate) fn begin(&self, entries: &[RenameEntry]) -> Result<String, String> {
        if entries.is_empty() || entries.len() > MAX_JOURNALED_ENTRIES {
            return Err("The file operation journal received an invalid batch.".into());
        }
        self.ensure_ready()?;
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH)
            .unwrap_or_default().as_nanos();
        let operation_id = format!("rename-{}-{timestamp}", std::process::id());
        let payload = serde_json::to_string(&RenameJournal {
            version: JOURNAL_VERSION,
            entries: entries.to_vec(),
        }).map_err(|error| format!("Could not serialize the file operation journal: {error}"))?;
        let connection = self.connection.lock()
            .map_err(|_| "The file operation journal is unavailable.")?;
        connection.execute(
            "INSERT INTO workspace_operation_journal(operation_id,payload,created_at) VALUES(?1,?2,?3)",
            params![operation_id, payload, timestamp.min(i64::MAX as u128) as i64],
        ).map_err(|error| format!("Could not persist the file operation before starting: {error}"))?;
        Ok(operation_id)
    }

    pub(crate) fn complete(&self, operation_id: &str) -> Result<(), String> {
        let connection = self.connection.lock()
            .map_err(|_| "The file operation journal is unavailable.")?;
        connection.execute(
            "DELETE FROM workspace_operation_journal WHERE operation_id=?1",
            params![operation_id],
        ).map_err(|error| format!("The file operation completed, but its recovery record could not be cleared: {error}"))?;
        Ok(())
    }

    pub(crate) fn ensure_ready(&self) -> Result<(), String> {
        let error = self.recovery_error.lock()
            .map_err(|_| "The file recovery status is unavailable.")?;
        if let Some(message) = error.as_ref() {
            return Err(format!("A previous file operation needs recovery before another batch rename can run: {message}"));
        }
        drop(error);
        let connection = self.connection.lock()
            .map_err(|_| "The file operation journal is unavailable.")?;
        let pending: i64 = connection.query_row(
            "SELECT COUNT(*) FROM workspace_operation_journal",
            [], |row| row.get(0)
        ).map_err(|_| "Could not verify pending file operation recovery.")?;
        if pending > 0 {
            return Err("A previous file operation is still journaled and must be recovered before another batch rename can run.".into());
        }
        Ok(())
    }

    pub fn recovery_status(&self) -> Result<Option<String>, String> {
        if let Some(message) = self.recovery_error.lock()
            .map_err(|_| "The file recovery status is unavailable.")?.clone() {
            return Ok(Some(message));
        }
        let connection = self.connection.lock()
            .map_err(|_| "The file operation journal is unavailable.")?;
        let pending: i64 = connection.query_row(
            "SELECT COUNT(*) FROM workspace_operation_journal",
            [], |row| row.get(0)
        ).map_err(|_| "Could not inspect pending file operation recovery.")?;
        Ok(if pending > 0 {
            Some("An interrupted file operation is waiting for recovery. Restart NEXUS to retry automatic recovery.".into())
        } else {
            None
        })
    }

    pub fn recover(&self, access: &WorkspaceAccess) -> Result<(), String> {
        let pending = {
            let connection = self.connection.lock()
                .map_err(|_| "The file operation journal is unavailable.")?;
            let mut statement = connection.prepare(
                "SELECT operation_id,payload FROM workspace_operation_journal ORDER BY created_at DESC LIMIT ?1"
            ).map_err(|error| format!("Could not inspect pending file operations: {error}"))?;
            let rows = statement.query_map([MAX_JOURNALED_OPERATIONS as i64], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }).map_err(|error| format!("Could not read pending file operations: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Could not decode pending file operations: {error}"))?
        };

        if pending.len() >= MAX_JOURNALED_OPERATIONS {
            let message = "Too many unfinished file operations are recorded; manual review is required.".to_string();
            self.set_recovery_error(Some(message.clone()))?;
            return Err(message);
        }

        for (operation_id, payload) in pending {
            let journal: RenameJournal = match serde_json::from_str(&payload) {
                Ok(value) if value.version == JOURNAL_VERSION
                    && !value.entries.is_empty()
                    && value.entries.len() <= MAX_JOURNALED_ENTRIES => value,
                _ => {
                    let message = "A pending file operation journal is invalid and was preserved for manual review.".to_string();
                    self.set_recovery_error(Some(message.clone()))?;
                    return Err(message);
                }
            };

            for entry in journal.entries.iter().rev() {
                if let Err(error) = rollback_entry(access, entry) {
                    let message = format!("Automatic recovery stopped without deleting its journal. {error}");
                    self.set_recovery_error(Some(message.clone()))?;
                    return Err(message);
                }
            }
            self.complete(&operation_id)?;
        }

        self.set_recovery_error(None)?;
        Ok(())
    }

    fn set_recovery_error(&self, message: Option<String>) -> Result<(), String> {
        *self.recovery_error.lock()
            .map_err(|_| "The file recovery status is unavailable.")? = message;
        Ok(())
    }
}

fn rollback_entry(access: &WorkspaceAccess, entry: &RenameEntry) -> Result<(), String> {
    let source_parent = entry.source.parent()
        .ok_or_else(|| "A journaled source has no parent directory.".to_string())?;
    let destination_parent = entry.destination.parent()
        .ok_or_else(|| "A journaled destination has no parent directory.".to_string())?;
    let source_root = access.allowed_root_for(source_parent)?;
    let destination_root = access.allowed_root_for(destination_parent)?;
    let canonical_source_parent = fs::canonicalize(source_parent)
        .map_err(|error| format!("Could not resolve a journaled source directory: {error}"))?;
    let canonical_destination_parent = fs::canonicalize(destination_parent)
        .map_err(|error| format!("Could not resolve a journaled destination directory: {error}"))?;
    if source_root != destination_root
        || canonical_source_parent != canonical_destination_parent
        || !canonical_source_parent.starts_with(&source_root) {
        return Err("A journaled rename no longer resolves to its original approved directory.".into());
    }

    let source_name = entry.source.file_name()
        .ok_or_else(|| "A journaled source has no valid name.".to_string())?;
    let destination_name = entry.destination.file_name()
        .ok_or_else(|| "A journaled destination has no valid name.".to_string())?;
    let source = canonical_source_parent.join(source_name);
    let destination = canonical_destination_parent.join(destination_name);

    let source_metadata = fs::symlink_metadata(&source);
    let destination_metadata = fs::symlink_metadata(&destination);
    match (source_metadata, destination_metadata) {
        (Ok(source_meta), Err(destination_error))
            if destination_error.kind() == std::io::ErrorKind::NotFound
                && source_meta.is_file() && !source_meta.file_type().is_symlink() => Ok(()),
        (Err(source_error), Ok(destination_meta))
            if source_error.kind() == std::io::ErrorKind::NotFound
                && destination_meta.is_file() && !destination_meta.file_type().is_symlink() => {
                    crate::workspace_fs_ops::rename_no_replace(&destination, &source)
                        .map_err(|error| format!("Could not restore a renamed file to its original name: {error}"))
                }
        (Ok(_), Ok(_)) => Err("Both original and renamed paths exist; recovery will not overwrite either file.".into()),
        (Err(source_error), Err(destination_error))
            if source_error.kind() == std::io::ErrorKind::NotFound
                && destination_error.kind() == std::io::ErrorKind::NotFound =>
                Err("Neither the original nor renamed path exists; recovery cannot infer the correct action.".into()),
        _ => Err("A journaled path is a link, special entry, or cannot be inspected safely.".into()),
    }
}

#[tauri::command]
pub fn get_workspace_operation_recovery_status(
    journal: tauri::State<'_, WorkspaceOperationJournal>,
) -> Result<Option<String>, String> {
    journal.recovery_status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (PathBuf, PathBuf, WorkspaceAccess, WorkspaceOperationJournal) {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos();
        let base = std::env::temp_dir().join(format!("nexus-fs-recovery-{}-{nonce}", std::process::id()));
        let root = base.join("approved");
        fs::create_dir_all(&root).expect("create approved root");
        let permissions = base.join("permissions.json");
        fs::write(&permissions, serde_json::to_vec(&vec![root.to_string_lossy().into_owned()]).expect("serialize roots"))
            .expect("write permissions");
        let access = WorkspaceAccess::load(permissions);
        let journal = WorkspaceOperationJournal::open(&base.join("journal.sqlite")).expect("open journal");
        (base, root, access, journal)
    }

    #[test]
    fn recovery_rolls_back_a_rename_interrupted_after_the_move() {
        let (base, root, access, journal) = fixture();
        let source = root.join("draft.txt");
        let destination = root.join("final.txt");
        fs::write(&destination, "original contents").expect("write moved file");
        let id = journal.begin(&[RenameEntry { source: source.clone(), destination: destination.clone() }])
            .expect("persist pending operation");
        journal.recover(&access).expect("recover interrupted operation");
        assert!(source.exists());
        assert!(!destination.exists());
        assert!(journal.recovery_status().expect("status").is_none());
        let connection = journal.connection.lock().expect("journal connection");
        let remaining: i64 = connection.query_row(
            "SELECT COUNT(*) FROM workspace_operation_journal WHERE operation_id=?1",
            [&id], |row| row.get(0)
        ).expect("count pending journal rows");
        assert_eq!(remaining, 0);
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn recovery_leaves_conflicting_paths_untouched_and_blocks_new_batches() {
        let (base, root, access, journal) = fixture();
        let source = root.join("draft.txt");
        let destination = root.join("final.txt");
        fs::write(&source, "source").expect("write source");
        fs::write(&destination, "destination").expect("write destination");
        journal.begin(&[RenameEntry { source: source.clone(), destination: destination.clone() }])
            .expect("persist pending operation");
        assert!(journal.recover(&access).is_err());
        assert_eq!(fs::read_to_string(&source).unwrap(), "source");
        assert_eq!(fs::read_to_string(&destination).unwrap(), "destination");
        assert!(journal.ensure_ready().is_err());
        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn recovery_never_follows_a_symlink_at_a_journaled_destination() {
        use std::os::unix::fs::symlink;
        let (base, root, access, journal) = fixture();
        let outside = base.join("outside.txt");
        let source = root.join("draft.txt");
        let destination = root.join("final.txt");
        fs::write(&outside, "outside").expect("write outside");
        symlink(&outside, &destination).expect("create destination symlink");
        journal.begin(&[RenameEntry { source: source.clone(), destination: destination.clone() }])
            .expect("persist pending operation");
        assert!(journal.recover(&access).is_err());
        assert!(destination.is_symlink());
        assert_eq!(fs::read_to_string(&outside).unwrap(), "outside");
        fs::remove_dir_all(base).expect("cleanup");
    }
}
