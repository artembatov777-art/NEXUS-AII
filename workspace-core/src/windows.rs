use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions, OpenOptionsExt};
use std::{ffi::OsStr, fmt::Write, fs, io, mem::size_of, os::windows::io::AsRawHandle};
use windows_sys::Win32::Foundation::{ERROR_LOCK_VIOLATION, ERROR_SHARING_VIOLATION};
use windows_sys::Win32::Storage::FileSystem::{
    FileBasicInfo, FileIdInfo, FileStandardInfo, GetFileInformationByHandleEx,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_BASIC_INFO, FILE_ID_INFO, FILE_INFO_BY_HANDLE_CLASS,
    FILE_SHARE_READ, FILE_STANDARD_INFO,
};

fn query<T: Default>(file: &fs::File, class: FILE_INFO_BY_HANDLE_CLASS) -> io::Result<T> {
    let mut info = T::default();
    // The call sites pair each information class with its Windows SDK structure.
    let result = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            class,
            (&mut info as *mut T).cast(),
            size_of::<T>() as u32,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(info)
    }
}

/// Hold the name and block ordinary writes for the duration of a snapshot.
pub(super) fn open_snapshot(dir: &Dir, name: &OsStr) -> Result<fs::File, String> {
    crate::normal(name)?;
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    options.share_mode(FILE_SHARE_READ);
    dir.open_with(name, &options)
        .map(cap_std::fs::File::into_std)
        .map_err(|error| match error.raw_os_error().map(|code| code as u32) {
            Some(ERROR_SHARING_VIOLATION | ERROR_LOCK_VIOLATION) => {
                "Workspace file is locked by another process. Close the editor or wait for it to release the file.".into()
            }
            _ => format!("Cannot open workspace file for a stable snapshot: {error}"),
        })
}

/// Bind a revision to a handle, including identity across same-byte replacements
/// and the NTFS change time in addition to the user-settable last-write time.
pub(super) fn revision(file: &fs::File) -> Result<String, String> {
    let basic: FILE_BASIC_INFO = query(file, FileBasicInfo)
        .map_err(|error| format!("Cannot inspect file times: {error}"))?;
    let standard: FILE_STANDARD_INFO = query(file, FileStandardInfo)
        .map_err(|error| format!("Cannot inspect file links and size: {error}"))?;
    if basic.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || standard.Directory
        || standard.DeletePending
        || standard.NumberOfLinks != 1
    {
        return Err("Only regular, single-link files can be snapshotted".into());
    }
    let id: FILE_ID_INFO = query(file, FileIdInfo)
        .map_err(|error| format!("Cannot inspect file identity: {error}"))?;
    let mut revision = format!("win:{}", id.VolumeSerialNumber);
    revision.push(':');
    for byte in id.FileId.Identifier {
        write!(revision, "{byte:02x}").expect("writing to String cannot fail");
    }
    write!(
        revision,
        ":{}:{}:{}",
        basic.ChangeTime, basic.LastWriteTime, standard.EndOfFile
    )
    .expect("writing to String cannot fail");
    Ok(revision)
}

// Exercise staging on a native runner without registering a Windows write tool.
// The delete-on-close staging handle cannot be used to publish a replacement.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{read_open_text, Workspace};
    use std::{
        io::Write,
        path::Path,
        sync::atomic::{AtomicU64, Ordering},
    };
    use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_DELETE_ON_CLOSE;

    static NEXT_STAGE: AtomicU64 = AtomicU64::new(0);

    fn stage(
        dir: &Dir,
        name: &OsStr,
        expected: (&str, &str),
        content: &str,
    ) -> Result<(fs::File, fs::File), String> {
        if content.len() > 48_000 {
            return Err("Replacement exceeds the workspace text limit".into());
        }
        // Disallow other writable/delete handles while comparing and staging.
        let original = open_snapshot(dir, name)?;
        let original_revision = revision(&original)?;
        if original_revision != expected.1 || read_open_text(&original, 48_000)? != expected.0 {
            return Err("File changed; prepare a new draft".into());
        }

        let temporary_name = format!(
            ".nexus-stage-{}-{}",
            std::process::id(),
            NEXT_STAGE.fetch_add(1, Ordering::Relaxed)
        );
        let mut options = OpenOptions::new();
        options
            .read(true)
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        options
            .custom_flags(FILE_FLAG_DELETE_ON_CLOSE)
            .share_mode(0);
        let mut temporary = dir
            .open_with(&temporary_name, &options)
            .map_err(|error| format!("Cannot create exclusive staging file: {error}"))?
            .into_std();
        temporary
            .write_all(content.as_bytes())
            .and_then(|_| temporary.sync_all())
            .map_err(|error| format!("Cannot persist the staging file: {error}"))?;
        if revision(&original)? != original_revision {
            return Err("File changed during staging".into());
        }
        Ok((original, temporary))
    }

    #[test]
    fn staging_is_private_to_its_handles_and_drops_without_touching_the_original() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("nexus-windows-stage-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let target = root.join("note");
        fs::write(&target, "original").unwrap();
        let ws = Workspace::grant(&root).unwrap();
        let dir = ws.directory(Path::new("")).unwrap();
        let (_, revision) = ws.snapshot(Path::new("note")).unwrap();
        assert!(stage(&dir, OsStr::new("note"), ("original", "stale"), "new").is_err());
        assert!(stage(
            &dir,
            OsStr::new("note"),
            ("original", &revision),
            &"x".repeat(48_001)
        )
        .is_err());
        let (original, mut staged) =
            stage(&dir, OsStr::new("note"), ("original", &revision), "new").unwrap();
        assert!(fs::OpenOptions::new().write(true).open(&target).is_err());
        use std::io::{Read, Seek, SeekFrom};
        staged.seek(SeekFrom::Start(0)).unwrap();
        let mut bytes = String::new();
        staged.read_to_string(&mut bytes).unwrap();
        assert_eq!(bytes, "new");
        drop(staged);
        drop(original);
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        drop(dir);
        drop(ws);
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
#[path = "windows_replace.rs"]
mod replacement;
