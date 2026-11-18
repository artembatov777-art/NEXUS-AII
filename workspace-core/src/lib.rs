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

fn normal(name: &OsStr) -> Result<(), String> {
    if Path::new(name).components().count() != 1
        || Path::new(name).file_name() != Some(name)
        || cfg!(windows) && name.to_string_lossy().contains([':', '\\'])
    {
        return Err("Invalid workspace component".into());
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
    if !metadata.is_file() || metadata.len() > limit {
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
    #[cfg(target_os = "linux")]
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

    #[cfg(target_os = "linux")]
    pub fn edit(&self, path: &Path, expected: &str, content: &str) -> Result<(), String> {
        let (_, revision) = self.snapshot(path)?;
        self.edit_checked(path, expected, &revision, content)
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
    ) -> Result<(), String> {
        use cap_std::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
        use std::io::Write;
        use std::os::fd::AsRawFd;
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
        lock.sync_all()
            .map_err(|_| "Directory sync unavailable; file was not replaced")?;
        let mut nonce = [0u8; 16];
        if unsafe { libc::getrandom(nonce.as_mut_ptr().cast(), nonce.len(), 0) }
            != nonce.len() as isize
        {
            return Err("Cannot generate staging filename".into());
        }
        let temp = format!(".nexus-edit-{:032x}", u128::from_ne_bytes(nonce));
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No)
            .mode(0o600);
        let mut staged = dir
            .open_with(&temp, &options)
            .map_err(|_| "Cannot create temporary file")?;
        let mut replaced = false;
        let result = (|| -> Result<(), String> {
            if staged
                .metadata()
                .map_err(|_| "Cannot inspect temporary file")?
                .gid()
                != metadata.gid()
            {
                return Err("Replacement would change file group ownership".into());
            }
            require_no_extended_attributes(
                &staged
                    .try_clone()
                    .map_err(|_| "Cannot verify temporary file")?
                    .into_std(),
            )?;
            staged
                .write_all(content.as_bytes())
                .map_err(|_| "Cannot write temporary file")?;
            staged
                .set_permissions(cap_std::fs::Permissions::from_mode(
                    metadata.permissions().mode() & 0o777,
                ))
                .map_err(|_| "Cannot set temporary file permissions")?;
            staged
                .sync_all()
                .map_err(|_| "Cannot sync temporary file")?;
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
            let current_parent = self
                .directory(parent)?
                .dir_metadata()
                .map_err(|_| "Cannot verify parent")?;
            let pinned = dir.dir_metadata().map_err(|_| "Cannot inspect parent")?;
            if current_parent.dev() != pinned.dev() || current_parent.ino() != pinned.ino() {
                return Err("Parent directory changed; select a project again".into());
            }
            check()?;
            dir.rename(&temp, &dir, name)
                .map_err(|_| "Cannot replace file")?;
            replaced = true;
            lock.sync_all()
                .map_err(|_| "File replaced but directory sync failed; inspect before retrying")?;
            Ok(())
        })();
        if !replaced {
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
    normal(name)?;
    dir.open_dir_nofollow(name)
        .map_err(|_| "Directory unavailable".into())
}
