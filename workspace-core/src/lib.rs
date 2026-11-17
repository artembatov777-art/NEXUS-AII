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
