use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use std::{
    ffi::OsStr,
    fs,
    io::Read,
    path::{Component, Path},
};
/// Refuse hard-linked files: a second directory entry may expose the same inode
/// outside the owner-approved workspace, even when the selected path is inside it.
pub fn ensure_no_external_hard_links(file: &fs::File) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let metadata = file
            .metadata()
            .map_err(|_| "NEXUS could not verify whether the file has external hard links.")?;
        if metadata.nlink() > 1 {
            return Err("NEXUS will not access a hard-linked file because another path may expose the same data.".into());
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
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

/// Reject all Windows reparse tags, including junctions and tags not exposed
/// as symbolic links by Rust's FileType.
pub fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

/// Same reparse check for metadata obtained relative to a directory capability.
pub fn is_capability_link_or_reparse(metadata: &cap_std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use cap_std::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
mod windows;
fn normal(name: &OsStr) -> Result<(), String> {
    if Path::new(name).components().count() != 1 || Path::new(name).file_name() != Some(name) {
        return Err("Invalid workspace component".into());
    }
    #[cfg(windows)]
    {
        let name = name.to_string_lossy();
        let stem = name
            .split('.')
            .next()
            .unwrap_or("")
            .trim_end()
            .to_ascii_uppercase();
        let numbered_device = stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            });
        if name.contains([':', '\\', '*', '?', '"', '<', '>', '|'])
            || name.chars().any(char::is_control)
            || name.ends_with(['.', ' '])
            || numbered_device
            || matches!(
                stem.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            )
        {
            return Err("Invalid Windows workspace component".into());
        }
    }
    Ok(())
}

fn open_text(dir: &Dir, name: &OsStr) -> Result<fs::File, String> {
    normal(name)?;
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    dir.open_with(name, &options)
        .map(|f| f.into_std())
        .map_err(|_| "File unavailable".into())
}

fn read_open_text(file: &fs::File, limit: u64) -> Result<String, String> {
    let metadata = file.metadata().map_err(|_| "Cannot inspect file")?;
    if !metadata.is_file() || is_link_or_reparse(&metadata) || metadata.len() > limit {
        return Err("File type or size exceeds preview limit".into());
    }
    ensure_no_external_hard_links(file)?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read file")?;
    if bytes.len() as u64 > limit {
        return Err("File exceeds preview limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not UTF-8 text".into())
}

pub fn read_text(dir: &Dir, name: &OsStr, limit: u64) -> Result<String, String> {
    read_open_text(&open_text(dir, name)?, limit)
}

#[cfg(target_os = "linux")]
fn require_no_extended_attributes(file: &fs::File) -> Result<(), String> {
    use std::os::fd::AsRawFd;
    let count = unsafe { libc::flistxattr(file.as_raw_fd(), std::ptr::null_mut(), 0) };
    if count == 0
        || (count < 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOTSUP))
    {
        Ok(())
    } else {
        Err("Unsupported or unverifiable extended attributes on edit file".into())
    }
}

#[cfg(target_os = "linux")]
fn revision(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::MetadataExt;
    format!(
        "{}:{}:{}:{}:{}",
        metadata.dev(),
        metadata.ino(),
        metadata.ctime(),
        metadata.ctime_nsec(),
        metadata.len()
    )
}

pub struct Workspace(Dir);
impl Workspace {
    pub fn grant(path: &Path) -> Result<Self, String> {
        if !path.is_absolute() {
            return Err("Select an absolute directory".into());
        }
        let mut anchor = std::path::PathBuf::new();
        let mut parts = path.components().peekable();
        #[cfg(windows)]
        match parts.next() {
            Some(Component::Prefix(p))
                if matches!(
                    p.kind(),
                    std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)
                ) =>
            {
                anchor.push(p.as_os_str())
            }
            _ => return Err("Select a local drive".into()),
        }
        match parts.next() {
            Some(c @ Component::RootDir) => anchor.push(c.as_os_str()),
            _ => return Err("Invalid root".into()),
        }
        let mut dir = Dir::open_ambient_dir(anchor, cap_std::ambient_authority())
            .map_err(|_| "Drive unavailable")?;
        for part in parts {
            dir = child(&dir, part)?;
        }
        Ok(Self(dir))
    }
    pub fn directory(&self, path: &Path) -> Result<Dir, String> {
        let mut dir = self.0.try_clone().map_err(|_| "Project closed")?;
        for part in path.components() {
            dir = child(&dir, part)?;
        }
        Ok(dir)
    }
    #[cfg(any(target_os = "linux", windows))]
    pub fn snapshot(&self, path: &Path) -> Result<(String, String), String> {
        let dir = self.directory(path.parent().ok_or("Missing parent")?)?;
        Self::snapshot_at(&dir, path.file_name().ok_or("Missing filename")?)
    }

    #[cfg(target_os = "linux")]
    fn snapshot_at(dir: &Dir, name: &OsStr) -> Result<(String, String), String> {
        let file = open_text(dir, name)?;
        let before = revision(&file.metadata().map_err(|_| "Cannot inspect file")?);
        let text = read_open_text(&file, 48000)?;
        let after = revision(&file.metadata().map_err(|_| "Cannot inspect file")?);
        if before != after {
            return Err("File changed while being read".into());
        }
        Ok((text, after))
    }

    #[cfg(windows)]
    fn snapshot_at(dir: &Dir, name: &OsStr) -> Result<(String, String), String> {
        let file = windows::open_snapshot(dir, name)?;
        let before = windows::revision(&file)?;
        let text = read_open_text(&file, 48_000)?;
        if before != windows::revision(&file)? {
            return Err("File changed while being read".into());
        }
        Ok((text, before))
    }

    #[cfg(target_os = "linux")]
    pub fn edit(&self, path: &Path, expected: &str, content: &str) -> Result<(), String> {
        let (_, revision) = self.snapshot(path)?;
        self.edit_checked(path, expected, &revision, content)
            .map(|_| ())
    }

    /// The directory lock serializes NEXUS writers. External writers need not
    /// honor it. rename is atomic, but the final check and rename are not CAS.
    #[cfg(target_os = "linux")]
    pub fn edit_checked(
        &self,
        path: &Path,
        expected: &str,
        expected_revision: &str,
        content: &str,
    ) -> Result<String, String> {
        self.edit_with_sync(
            path,
            expected,
            expected_revision,
            content,
            fs::File::sync_all,
        )
    }

    #[cfg(target_os = "linux")]
    fn edit_with_sync(
        &self,
        path: &Path,
        expected: &str,
        expected_revision: &str,
        content: &str,
        sync: impl Fn(&fs::File) -> std::io::Result<()>,
    ) -> Result<String, String> {
        use cap_std::fs::{MetadataExt, OpenOptionsExt};
        use std::io::Write;
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::fs::{
            MetadataExt as StdMetadataExt, PermissionsExt as StdPermissionsExt,
        };

        if expected.len() > 48000 || content.len() > 48000 {
            return Err("File exceeds edit limit".into());
        }
        let parent = path.parent().ok_or("Missing parent")?;
        let dir = self.directory(parent)?;
        let name = path.file_name().ok_or("Missing filename")?;
        let mut lock_options = OpenOptions::new();
        lock_options.read(true).custom_flags(libc::O_DIRECTORY);
        let lock = dir
            .open_with(".", &lock_options)
            .map_err(|_| "Cannot open directory lock")?
            .into_std();
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            return Err("Workspace edit is busy or directory locking is unavailable".into());
        }
        let parent_meta = lock
            .metadata()
            .map_err(|_| "Cannot inspect edit directory")?;
        if parent_meta.uid() != unsafe { libc::geteuid() } || parent_meta.mode() & 0o022 != 0 {
            return Err(
                "Editing requires an owner-owned directory without group or public write access"
                    .into(),
            );
        }
        let check = || -> Result<(), String> {
            let (text, current_revision) = Self::snapshot_at(&dir, name)?;
            if text != expected || current_revision != expected_revision {
                return Err("File changed; prepare a new draft".into());
            }
            Ok(())
        };
        check()?;
        let original = open_text(&dir, name)?;
        let metadata = original.metadata().map_err(|_| "Cannot inspect file")?;
        // A replacement has a fresh inode. Restrict edits to owner-owned,
        // ordinary files with no special mode bits.
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o7022 != 0
            || revision(&metadata) != expected_revision
        {
            return Err("File ownership, mode or revision does not permit replacement".into());
        }

        require_no_extended_attributes(&original)?;
        sync(&lock).map_err(|_| "Directory sync unavailable; file was not replaced")?;
        let mut nonce = [0u8; 16];
        if unsafe { libc::getrandom(nonce.as_mut_ptr().cast(), nonce.len(), 0) }
            != nonce.len() as isize
        {
            return Err("Cannot generate staging filename".into());
        }
        let temp = format!(".nexus-edit-{:032x}", u128::from_ne_bytes(nonce));
        // Until the last pre-commit checks, the staging inode has no pathname.
        // A killed host cannot leave a partial named file behind.
        let fd = unsafe {
            libc::openat(
                lock.as_raw_fd(),
                c".".as_ptr(),
                libc::O_TMPFILE | libc::O_WRONLY | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd < 0 {
            return Err("Filesystem does not support safe anonymous staging".into());
        }
        let mut staged = unsafe { fs::File::from_raw_fd(fd) };
        let mut linked = false;
        let mut replaced = false;
        let result = (|| -> Result<String, String> {
            if staged
                .metadata()
                .map_err(|_| "Cannot inspect temporary file")?
                .gid()
                != metadata.gid()
            {
                return Err("Replacement would change file group ownership".into());
            }
            require_no_extended_attributes(&staged)?;
            staged
                .write_all(content.as_bytes())
                .map_err(|_| "Cannot write temporary file")?;
            staged
                .set_permissions(fs::Permissions::from_mode(
                    metadata.permissions().mode() & 0o777,
                ))
                .map_err(|_| "Cannot set temporary file permissions")?;
            sync(&staged).map_err(|_| "Cannot sync temporary file")?;
            let current_parent = self
                .directory(parent)?
                .dir_metadata()
                .map_err(|_| "Cannot verify parent")?;
            let pinned = dir.dir_metadata().map_err(|_| "Cannot inspect parent")?;
            if current_parent.dev() != pinned.dev() || current_parent.ino() != pinned.ino() {
                return Err("Parent directory changed; select a project again".into());
            }
            check()?;
            // Linux requires CAP_DAC_READ_SEARCH for linkat(AT_EMPTY_PATH).
            // Follow the process's own pinned fd through procfs instead.
            let fd_path =
                std::ffi::CString::new(format!("/proc/self/fd/{}", staged.as_raw_fd())).unwrap();
            let temp_name = std::ffi::CString::new(temp.as_str()).unwrap();
            if unsafe {
                libc::linkat(
                    libc::AT_FDCWD,
                    fd_path.as_ptr(),
                    lock.as_raw_fd(),
                    temp_name.as_ptr(),
                    libc::AT_SYMLINK_FOLLOW,
                )
            } != 0
            {
                return Err(
                    "Cannot publish the complete staging file; original was not replaced".into(),
                );
            }
            linked = true;
            let staged_metadata = staged
                .metadata()
                .map_err(|_| "Cannot inspect temporary file")?;
            let named = dir
                .symlink_metadata(&temp)
                .map_err(|_| "Temporary file changed")?;
            if !named.is_file()
                || named.dev() != staged_metadata.dev()
                || named.ino() != staged_metadata.ino()
                || named.nlink() != 1
            {
                return Err("Temporary file changed".into());
            }
            // Avoid another file read between this last check and rename. The
            // earlier full comparison was bound to this inode and revision.
            let latest = dir.symlink_metadata(name).map_err(|_| "File unavailable")?;
            if !latest.is_file()
                || latest.nlink() != 1
                || latest.dev() != metadata.dev()
                || latest.ino() != metadata.ino()
                || latest.ctime() != metadata.ctime()
                || latest.ctime_nsec() != metadata.ctime_nsec()
                || latest.len() != metadata.len()
            {
                return Err("File changed; prepare a new draft".into());
            }
            dir.rename(&temp, &dir, name)
                .map_err(|_| "Cannot replace file")?;
            replaced = true;
            sync(&lock)
                .map_err(|_| "File replaced but directory sync failed; inspect before retrying")?;
            let published = staged
                .metadata()
                .map_err(|_| "File replaced but its revision could not be verified")?;
            let (observed, observed_revision) = Self::snapshot_at(&dir, name)
                .map_err(|_| "File replaced but its current state could not be verified")?;
            if published.mode() != staged_metadata.mode()
                || published.uid() != staged_metadata.uid()
                || published.gid() != staged_metadata.gid()
                || published.mtime() != staged_metadata.mtime()
                || published.mtime_nsec() != staged_metadata.mtime_nsec()
                || revision(&published) != observed_revision
                || observed != content
            {
                return Err("File replaced but changed before confirmation".into());
            }
            Ok(observed_revision)
        })();
        if linked && !replaced {
            // Never unlink a replacement placed at the temporary name.
            if let (Ok(named), Ok(open)) = (dir.symlink_metadata(&temp), staged.metadata()) {
                if named.dev() == open.dev() && named.ino() == open.ino() {
                    let _ = dir.remove_file(&temp);
                }
            }
        }
        result
    }
    pub fn read(&self, path: &Path) -> Result<String, String> {
        let dir = self.directory(path.parent().ok_or("Missing parent")?)?;
        read_text(&dir, path.file_name().ok_or("Missing filename")?, 48000)
    }
}
fn child(dir: &Dir, part: Component<'_>) -> Result<Dir, String> {
    let Component::Normal(name) = part else {
        return Err("Invalid relative path".into());
    };
    open_child_directory(dir, name)
}

/// Opens exactly one child component without following links.
pub fn open_child_directory(dir: &Dir, name: &OsStr) -> Result<Dir, String> {
    normal(name)?;
    let child = dir
        .open_dir_nofollow(name)
        .map_err(|_| "Directory unavailable")?;
    #[cfg(windows)]
    {
        let metadata = child
            .dir_metadata()
            .map_err(|_| "Cannot inspect directory")?;
        if is_capability_link_or_reparse(&metadata) {
            return Err("Reparse-point directories are not allowed".into());
        }
    }
    Ok(child)
}

#[cfg(all(test, target_os = "linux"))]
mod edit_tests {
    use super::*;
    use std::{cell::Cell, io};

    #[test]
    fn distinguishes_staging_sync_error_from_post_rename_sync_error() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("nexus-sync-fault-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let ws = Workspace::grant(&root).unwrap();
        let note = Path::new("note");
        for (fail_at, expected) in [(2, "original"), (3, "replacement")] {
            fs::write(root.join(note), "original").unwrap();
            let (_, revision) = ws.snapshot(note).unwrap();
            let calls = Cell::new(0);
            let err = ws
                .edit_with_sync(note, "original", &revision, "replacement", |file| {
                    calls.set(calls.get() + 1);
                    if calls.get() == fail_at {
                        return Err(io::Error::other("injected sync failure"));
                    }
                    file.sync_all()
                })
                .unwrap_err();
            assert!(
                err.contains(if fail_at == 2 {
                    "sync temporary file"
                } else {
                    "File replaced"
                }),
                "{err}"
            );
            assert_eq!(ws.read(note).unwrap(), expected);
            assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn does_not_confirm_a_revision_replaced_before_the_reply() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("nexus-external-replacement-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let path = Path::new("note");
        fs::write(root.join(path), "original").unwrap();
        let ws = Workspace::grant(&root).unwrap();
        let (_, revision) = ws.snapshot(path).unwrap();
        let calls = Cell::new(0);
        let err = ws
            .edit_with_sync(path, "original", &revision, "replacement", |file| {
                calls.set(calls.get() + 1);
                if calls.get() == 3 {
                    // Substitute a distinct inode with identical contents after
                    // rename but before the host can return its revision.
                    fs::write(root.join("external"), "replacement")?;
                    fs::rename(root.join("external"), root.join(path))?;
                }
                file.sync_all()
            })
            .unwrap_err();
        assert!(err.contains("changed before confirmation"), "{err}");
        assert_eq!(ws.read(path).unwrap(), "replacement");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn observes_an_external_write_after_staging_starts() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("nexus-external-write-{}", std::process::id()));
        fs::create_dir(&root).unwrap();
        let path = Path::new("note");
        fs::write(root.join(path), "original").unwrap();
        let ws = Workspace::grant(&root).unwrap();
        let (_, revision) = ws.snapshot(path).unwrap();
        let err = ws
            .edit_with_sync(path, "original", &revision, "replacement", |file| {
                if file.metadata()?.is_file() {
                    let status = std::process::Command::new("sh")
                        .args(["-c", "printf external > \"$1\"", "sh"])
                        .arg(root.join(path))
                        .status()?;
                    assert!(status.success());
                }
                file.sync_all()
            })
            .unwrap_err();
        assert!(err.contains("File changed"), "{err}");
        assert_eq!(ws.read(path).unwrap(), "external");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}
