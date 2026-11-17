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
pub fn read_text(dir: &Dir, name: &OsStr, limit: u64) -> Result<String, String> {
    normal(name)?;
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    #[cfg(unix)]
    {
        use cap_std::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = dir
        .open_with(name, &options)
        .map_err(|_| "File unavailable")?
        .into_std();
    let metadata = file.metadata().map_err(|_| "Cannot inspect file")?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("File type or size exceeds preview limit".into());
    }
    ensure_no_external_hard_links(&file)?;
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read file")?;
    if bytes.len() as u64 > limit {
        return Err("File exceeds preview limit".into());
    }
    String::from_utf8(bytes).map_err(|_| "File is not UTF-8 text".into())
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
    pub fn edit(&self, path: &Path, expected: &str, content: &str) -> Result<(), String> {
        use cap_std::fs::PermissionsExt;
        use std::io::Write;
        use std::os::fd::AsRawFd;
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        if expected.len() > 48000 || content.len() > 48000 {
            return Err("File exceeds edit limit".into());
        }
        let dir = self.directory(path.parent().ok_or("Missing parent")?)?;
        let name = path.file_name().ok_or("Missing filename")?;
        normal(name)?;
        let mut lock_options = OpenOptions::new();
        lock_options.read(true);
        let lock = dir
            .open_with(".", &lock_options)
            .map_err(|_| "Cannot open directory lock")?
            .into_std();
        if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err("Cannot lock directory".into());
        }
        let mut original_options = OpenOptions::new();
        original_options.read(true).follow(FollowSymlinks::No);
        let original = dir
            .open_with(name, &original_options)
            .map_err(|_| "File unavailable")?
            .into_std();
        let metadata = original.metadata().map_err(|_| "Cannot inspect file")?;
        if !metadata.is_file() {
            return Err("Not a regular file".into());
        }
        ensure_no_external_hard_links(&original)?;
        if read_text(&dir, name, 48000)? != expected {
            return Err("File changed; reload before editing".into());
        }
        let temp = format!(
            ".nexus-edit-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let mut staged = dir
            .open_with(&temp, &options)
            .map_err(|_| "Cannot create temporary file")?;
        let result = (|| -> Result<(), String> {
            staged
                .set_permissions(cap_std::fs::Permissions::from_mode({
                    use std::os::unix::fs::PermissionsExt as _;
                    metadata.permissions().mode()
                }))
                .map_err(|_| "Cannot set permissions")?;
            staged
                .write_all(content.as_bytes())
                .map_err(|_| "Cannot write temporary file")?;
            staged
                .sync_all()
                .map_err(|_| "Cannot sync temporary file")?;
            if read_text(&dir, name, 48000)? != expected {
                return Err("File changed; reload before editing".into());
            }
            dir.rename(&temp, &dir, name)
                .map_err(|_| "Cannot replace file")?;
            lock.sync_all()
                .map_err(|_| "File replaced but directory sync failed; inspect before retrying")?;
            Ok(())
        })();
        let _ = dir.remove_file(&temp);
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
