//! Native test candidate. Neither the shipped Windows host nor Tauri calls this.
use super::{query, revision};
use crate::{open_child_directory, read_open_text, Workspace};
use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt, OpenOptionsMaybeDirExt};
use cap_std::fs::{Dir, OpenOptions, OpenOptionsExt};
use std::{
    ffi::OsStr,
    fs::File,
    io::{self, Seek, SeekFrom, Write},
    mem::{offset_of, size_of, size_of_val},
    os::windows::{ffi::OsStrExt, io::AsRawHandle},
    path::{Component, Path},
    ptr::null_mut,
    sync::atomic::{AtomicU64, Ordering},
};
use windows_sys::{
    Wdk::Storage::FileSystem::{
        FileEaInformation, FileRenameInformationEx, NtQueryInformationFile, NtSetInformationFile,
        FILE_EA_INFORMATION, FILE_RENAME_INFORMATION, FILE_RENAME_POSIX_SEMANTICS,
        FILE_RENAME_REPLACE_IF_EXISTS,
    },
    Win32::{
        Foundation::{RtlNtStatusToDosError, GENERIC_READ, GENERIC_WRITE},
        Security::{
            GetKernelObjectSecurity, DACL_SECURITY_INFORMATION, GROUP_SECURITY_INFORMATION,
            LABEL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, SACL_SECURITY_INFORMATION,
        },
        Storage::FileSystem::*,
        System::{SystemServices::ACCESS_SYSTEM_SECURITY, IO::IO_STATUS_BLOCK},
    },
};

static NEXT_STAGE: AtomicU64 = AtomicU64::new(0);

fn nt_result(status: i32) -> io::Result<()> {
    // All files in this module are opened synchronously.
    if status >= 0 {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(
            unsafe { RtlNtStatusToDosError(status) } as i32,
        ))
    }
}

fn local_ntfs(file: &File) -> io::Result<()> {
    let mut fs_name = [0u16; 32];
    let result = unsafe {
        GetVolumeInformationByHandleW(
            file.as_raw_handle(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            null_mut(),
            fs_name.as_mut_ptr(),
            fs_name.len() as u32,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    if !fs_name.starts_with(&[b'N' as u16, b'T' as u16, b'F' as u16, b'S' as u16, 0]) {
        return Err(io::Error::other("Workspace replacement requires NTFS"));
    }
    // A mounted local volume can be named by GUID. SMB paths cannot.
    let result = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            null_mut(),
            0,
            VOLUME_NAME_GUID | FILE_NAME_OPENED,
        )
    };
    if result == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn security_descriptor(file: &File) -> io::Result<Vec<u8>> {
    let mut data = [0u64; 1024];
    let mut needed = 0;
    let flags = OWNER_SECURITY_INFORMATION
        | GROUP_SECURITY_INFORMATION
        | DACL_SECURITY_INFORMATION
        | LABEL_SECURITY_INFORMATION
        | SACL_SECURITY_INFORMATION;
    if unsafe {
        GetKernelObjectSecurity(
            file.as_raw_handle(),
            flags,
            data.as_mut_ptr().cast(),
            size_of::<[u64; 1024]>() as u32,
            &mut needed,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(data.as_ptr().cast::<u8>(), size_of::<[u64; 1024]>()) };
    bytes
        .get(..needed as usize)
        .filter(|data| !data.is_empty())
        .map(<[u8]>::to_vec)
        .ok_or_else(|| io::Error::other("Invalid NTFS security descriptor"))
}

fn require_plain_file(file: &File) -> io::Result<()> {
    let basic: FILE_BASIC_INFO = query(file, FileBasicInfo)?;
    if basic.FileAttributes & !(FILE_ATTRIBUTE_NORMAL | FILE_ATTRIBUTE_ARCHIVE) != 0 {
        return Err(io::Error::other("Unsupported NTFS file attributes"));
    }

    let mut ea = FILE_EA_INFORMATION::default();
    nt_result(unsafe {
        NtQueryInformationFile(
            file.as_raw_handle(),
            &mut IO_STATUS_BLOCK::default(),
            (&mut ea as *mut FILE_EA_INFORMATION).cast(),
            size_of::<FILE_EA_INFORMATION>() as u32,
            FileEaInformation,
        )
    })?;
    if ea.EaSize != 0 {
        return Err(io::Error::other("NTFS extended attributes are unsupported"));
    }

    let mut streams = [0u64; 512];
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileStreamInfo,
            streams.as_mut_ptr().cast(),
            size_of::<[u64; 512]>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let bytes = streams.as_ptr().cast::<u8>();
    // The kernel reports a linked sequence. Require just the unnamed data stream.
    let next = unsafe { bytes.cast::<u32>().read() };
    let name_size = unsafe {
        bytes
            .add(offset_of!(FILE_STREAM_INFO, StreamNameLength))
            .cast::<u32>()
            .read()
    };
    let unnamed = [
        b':' as u16,
        b':' as u16,
        b'$' as u16,
        b'D' as u16,
        b'A' as u16,
        b'T' as u16,
        b'A' as u16,
    ];
    if next != 0
        || name_size as usize != size_of_val(&unnamed)
        || unsafe {
            std::slice::from_raw_parts(
                bytes
                    .add(offset_of!(FILE_STREAM_INFO, StreamName))
                    .cast::<u16>(),
                unnamed.len(),
            )
        } != unnamed
    {
        return Err(io::Error::other("Additional or unverifiable NTFS streams"));
    }
    Ok(())
}

fn directory_for_publish(dir: &Dir) -> io::Result<File> {
    // Open the current pinned directory through its capability, requesting
    // FILE_ADD_FILE during the relative open. ReOpenFile cannot add these
    // rights reliably when the original directory handle was read-only.
    let mut options = OpenOptions::new();
    options
        .read(true)
        .maybe_dir(true)
        .follow(FollowSymlinks::No);
    options.access_mode(GENERIC_READ | FILE_ADD_FILE);
    options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
    let file = dir.open_with(".", &options)?.into_std();
    let metadata = file.metadata()?;
    if !metadata.is_dir() || crate::is_link_or_reparse(&metadata) {
        return Err(io::Error::other(
            "Publication requires a pinned regular directory",
        ));
    }
    let original: FILE_ID_INFO = query(&dir.try_clone()?.into_std_file(), FileIdInfo)?;
    let reopened: FILE_ID_INFO = query(&file, FileIdInfo)?;
    if original.VolumeSerialNumber != reopened.VolumeSerialNumber
        || original.FileId.Identifier != reopened.FileId.Identifier
    {
        return Err(io::Error::other("Publication directory identity changed"));
    }
    Ok(file)
}

fn disposition(file: &File, delete: bool) -> io::Result<()> {
    let info = FILE_DISPOSITION_INFO { DeleteFile: delete };
    if unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfo,
            (&info as *const FILE_DISPOSITION_INFO).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

struct Stage {
    file: File,
    published: bool,
}

impl Drop for Stage {
    fn drop(&mut self) {
        if !self.published {
            // Delete via the opened staging identity, never by a stale pathname.
            let _ = disposition(&self.file, true);
        }
    }
}

fn rename_over(file: &File, directory: &File, name: &OsStr) -> io::Result<()> {
    let wide: Vec<u16> = name.encode_wide().collect();
    let offset = offset_of!(FILE_RENAME_INFORMATION, FileName);
    let bytes = offset + size_of_val(wide.as_slice()) + size_of::<u16>();
    let mut storage = vec![0u64; bytes.div_ceil(8)];
    let ptr = storage.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
    unsafe {
        (*ptr).Anonymous.Flags = FILE_RENAME_REPLACE_IF_EXISTS | FILE_RENAME_POSIX_SEMANTICS;
        (*ptr).RootDirectory = directory.as_raw_handle();
        (*ptr).FileNameLength = size_of_val(wide.as_slice()) as u32;
        std::ptr::copy_nonoverlapping(
            wide.as_ptr(),
            storage.as_mut_ptr().cast::<u8>().add(offset).cast::<u16>(),
            wide.len(),
        );
        nt_result(NtSetInformationFile(
            file.as_raw_handle(),
            &mut IO_STATUS_BLOCK::default(),
            storage.as_ptr().cast(),
            bytes as u32,
            FileRenameInformationEx,
        ))
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
struct StageReceipt {
    target: std::path::PathBuf,
    original_revision: String,
    name: String,
    volume: u64,
    file_id: [u8; 16],
}

enum PublishPoint<'a> {
    Staged(&'a StageReceipt),
    Disarmed,
}

fn pinned_ancestors(workspace: &Workspace, parent: &Path) -> Result<Vec<Dir>, String> {
    let mut ancestors = vec![workspace.0.try_clone().map_err(|_| "Project closed")?];
    for part in parent.components() {
        let Component::Normal(name) = part else {
            return Err("Invalid relative path".into());
        };
        ancestors.push(open_child_directory(ancestors.last().unwrap(), name)?);
    }
    Ok(ancestors)
}

/// Exercise explicit recovery of the disarmed staging file. The caller must
/// supply a receipt from its trusted operation store, never a directory scan.
fn discard_stage(
    workspace: &Workspace,
    receipt: &StageReceipt,
    expected_content: &str,
) -> Result<(), String> {
    let invalid = "Invalid or stale staging receipt";
    let mut parts = receipt
        .name
        .strip_prefix(".nexus-win-edit-")
        .ok_or(invalid)?
        .split('-');
    if parts
        .next()
        .and_then(|part| part.parse::<u32>().ok())
        .is_none()
        || parts
            .next()
            .and_then(|part| part.parse::<u64>().ok())
            .is_none()
        || parts.next().is_some()
    {
        return Err(invalid.into());
    }
    let ancestors = pinned_ancestors(workspace, receipt.target.parent().ok_or(invalid)?)?;
    let dir = ancestors.last().unwrap();
    let original = super::open_snapshot(dir, receipt.target.file_name().ok_or(invalid)?)?;
    if revision(&original)? != receipt.original_revision {
        return Err("Original changed; staging file needs manual review".into());
    }
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    options.access_mode(GENERIC_READ | DELETE).share_mode(0);
    let staged = dir
        .open_with(&receipt.name, &options)
        .map_err(|e| e.to_string())?
        .into_std();
    revision(&staged)?;
    let identity: FILE_ID_INFO = query(&staged, FileIdInfo).map_err(|e| e.to_string())?;
    if identity.VolumeSerialNumber != receipt.volume
        || identity.FileId.Identifier != receipt.file_id
    {
        return Err(invalid.into());
    }
    require_plain_file(&staged).map_err(|e| e.to_string())?;
    if read_open_text(&staged, 48_000)? != expected_content {
        return Err("Staged content changed; staging file needs manual review".into());
    }
    disposition(&staged, true).map_err(|e| e.to_string())
}

fn edit(
    workspace: &Workspace,
    path: &Path,
    expected: &str,
    expected_revision: &str,
    content: &str,
    mut checkpoint: impl FnMut(PublishPoint<'_>) -> io::Result<()>,
) -> Result<String, String> {
    if content.len() > 48_000 {
        return Err("Replacement exceeds the workspace text limit".into());
    }
    let parent = path.parent().ok_or("Missing parent")?;
    let name = path.file_name().ok_or("Missing filename")?;
    let ancestors = pinned_ancestors(workspace, parent)?;
    let dir = ancestors.last().unwrap();
    crate::normal(name)?;
    let mut original_options = OpenOptions::new();
    original_options
        .read(true)
        .write(true)
        .follow(FollowSymlinks::No);
    // Require permission to write the original data even where the parent's
    // delete-child permission would otherwise allow a rename over the file.
    original_options
        .access_mode(GENERIC_READ | FILE_WRITE_DATA | ACCESS_SYSTEM_SECURITY)
        .share_mode(FILE_SHARE_READ);
    let original = dir
        .open_with(name, &original_options)
        .map_err(|error| format!("Cannot exclusively pin original for replacement: {error}"))?
        .into_std();
    if revision(&original)? != expected_revision || read_open_text(&original, 48_000)? != expected {
        return Err("File changed; prepare a new draft".into());
    }
    let prep = |error| format!("Windows replacement unavailable before publication: {error}");
    local_ntfs(&original).map_err(|e| prep(format!("inspect NTFS volume: {e}")))?;
    require_plain_file(&original)
        .map_err(|e| prep(format!("inspect original streams and attributes: {e}")))?;
    let security = security_descriptor(&original)
        .map_err(|e| prep(format!("read original security descriptor: {e}")))?;
    let directory = directory_for_publish(dir)
        .map_err(|e| prep(format!("open pinned publication directory: {e}")))?;

    let stage_name = format!(
        ".nexus-win-edit-{}-{}",
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
        .access_mode(GENERIC_READ | GENERIC_WRITE | DELETE | ACCESS_SYSTEM_SECURITY)
        .share_mode(0);
    let mut stage = Stage {
        file: dir
            .open_with(&stage_name, &options)
            .map_err(|e| prep(format!("create staging file: {e}")))?
            .into_std(),
        published: false,
    };
    disposition(&stage.file, true)
        .map_err(|error| prep(format!("mark staging file for cleanup: {error}")))?;
    if security_descriptor(&stage.file)
        .map_err(|e| prep(format!("read staging security descriptor: {e}")))?
        != security
    {
        return Err(
            "Replacement would change the NTFS owner, group, DACL, SACL or mandatory label".into(),
        );
    }
    stage
        .file
        .write_all(content.as_bytes())
        .and_then(|_| stage.file.sync_all())
        .map_err(|error| prep(format!("write and sync staging file: {error}")))?;
    require_plain_file(&stage.file)
        .map_err(|error| prep(format!("inspect staging streams and attributes: {error}")))?;
    let identity: FILE_ID_INFO = query(&stage.file, FileIdInfo)
        .map_err(|error| prep(format!("read staging identity: {error}")))?;
    checkpoint(PublishPoint::Staged(&StageReceipt {
        target: path.to_owned(),
        original_revision: expected_revision.to_owned(),
        name: stage_name,
        volume: identity.VolumeSerialNumber,
        file_id: identity.FileId.Identifier,
    }))
    .map_err(|error| prep(error.to_string()))?;
    require_plain_file(&original)
        .map_err(|e| prep(format!("inspect original streams and attributes: {e}")))?;
    if revision(&original)? != expected_revision
        || security_descriptor(&original)
            .map_err(|e| prep(format!("read original security descriptor: {e}")))?
            != security
    {
        return Err("File changed during staging".into());
    }
    if security_descriptor(&stage.file)
        .map_err(|e| prep(format!("read staging security descriptor: {e}")))?
        != security
    {
        return Err("Staging file security descriptor changed".into());
    }
    stage
        .file
        .seek(SeekFrom::Start(0))
        .map_err(|error| prep(error.to_string()))?;
    if read_open_text(&stage.file, 48_000)? != content {
        return Err("Staging file contents changed".into());
    }
    require_plain_file(&stage.file)
        .map_err(|error| prep(format!("inspect staging streams and attributes: {error}")))?;

    // The old handle remains open across the handle-relative rename. If the
    // filesystem refuses to replace that pinned file, there is no fallback.
    disposition(&stage.file, false)
        .map_err(|error| prep(format!("disarm staging cleanup: {error}")))?;
    checkpoint(PublishPoint::Disarmed).map_err(|error| prep(error.to_string()))?;
    if revision(&original)? != expected_revision {
        return Err("File changed just before publication".into());
    }
    if let Err(rename_error) = rename_over(&stage.file, &directory, name) {
        // Disarmed stages are otherwise cleaned up only by Drop, where a
        // failed delete disposition cannot be reported to the caller.
        // Restore delete-on-close while the staging identity is still pinned.
        // Never retry publication through a pathname or release the original
        // lock to make a sharing violation disappear.
        let cleanup = disposition(&stage.file, true);
        return Err(match cleanup {
            Ok(()) => prep(format!("rename staged file: {rename_error}")),
            Err(cleanup_error) => prep(format!(
                "rename staged file: {rename_error}; staging cleanup could not be confirmed: {cleanup_error}"
            )),
        });
    }
    stage.published = true;
    stage
        .file
        .sync_all()
        .map_err(|error| format!("Replacement applied but flush failed: {error}"))?;
    let published_error =
        |error| format!("Replacement published; metadata could not be confirmed: {error}");
    require_plain_file(&stage.file).map_err(published_error)?;
    if security_descriptor(&stage.file).map_err(published_error)? != security {
        return Err("Replacement published; security descriptor changed".into());
    }
    let published = revision(&stage.file)?;
    drop(stage);
    // The original requests FILE_WRITE_DATA. A new snapshot permits only
    // shared reads, so release the old handle after rename before reopening.
    drop(original);
    let (observed, found) = workspace.snapshot(path)?;
    if found != published || observed != content {
        return Err("Replacement was published but could not be confirmed".into());
    }
    Ok(published)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::windows::fs::OpenOptionsExt as _, path::PathBuf, process::Command};

    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows_sys::Win32::{
        Foundation::{GetLastError, LocalFree, ERROR_NOT_ALL_ASSIGNED, LUID},
        Security::{
            AdjustTokenPrivileges,
            Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW, ImpersonateSelf,
            LookupPrivilegeValueW, RevertToSelf, SecurityImpersonation, SetKernelObjectSecurity,
            LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, SE_SECURITY_NAME, TOKEN_ADJUST_PRIVILEGES,
            TOKEN_PRIVILEGES, TOKEN_QUERY,
        },
        System::Threading::{GetCurrentThread, OpenThreadToken},
    };

    // Enable the fixture privilege on the current test thread only. Production
    // code must never self-elevate to make a workspace edit succeed.
    struct AuditPrivilege;

    impl AuditPrivilege {
        fn enable() -> io::Result<Self> {
            if unsafe { ImpersonateSelf(SecurityImpersonation) } == 0 {
                return Err(io::Error::last_os_error());
            }
            let guard = Self;
            let mut token = null_mut();
            if unsafe {
                OpenThreadToken(
                    GetCurrentThread(),
                    TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
                    1,
                    &mut token,
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            let token = unsafe { OwnedHandle::from_raw_handle(token) };
            let mut luid = LUID::default();
            if unsafe { LookupPrivilegeValueW(null_mut(), SE_SECURITY_NAME, &mut luid) } == 0 {
                return Err(io::Error::last_os_error());
            }
            let privilege = TOKEN_PRIVILEGES {
                PrivilegeCount: 1,
                Privileges: [LUID_AND_ATTRIBUTES {
                    Luid: luid,
                    Attributes: SE_PRIVILEGE_ENABLED,
                }],
            };
            let result = unsafe {
                AdjustTokenPrivileges(
                    token.as_raw_handle(),
                    0,
                    &privilege,
                    0,
                    null_mut(),
                    null_mut(),
                )
            };
            let code = unsafe { GetLastError() };
            if result == 0 || code == ERROR_NOT_ALL_ASSIGNED {
                return Err(io::Error::from_raw_os_error(code as i32));
            }
            Ok(guard)
        }
    }

    impl Drop for AuditPrivilege {
        fn drop(&mut self) {
            assert_ne!(
                unsafe { RevertToSelf() },
                0,
                "Cannot revert test impersonation"
            );
        }
    }

    fn set_audit_rule(path: &Path) -> io::Result<()> {
        let file = fs::OpenOptions::new()
            .access_mode(ACCESS_SYSTEM_SECURITY)
            .open(path)?;
        let mut descriptor = null_mut();
        let sddl: Vec<u16> = "S:P(AU;SAFA;FW;;;WD)".encode_utf16().chain([0]).collect();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        let result = unsafe {
            SetKernelObjectSecurity(file.as_raw_handle(), SACL_SECURITY_INFORMATION, descriptor)
        };
        let error = io::Error::last_os_error();
        unsafe { LocalFree(descriptor) };
        if result == 0 {
            Err(error)
        } else {
            Ok(())
        }
    }

    struct Fixture(PathBuf);

    impl Fixture {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "nexus-windows-replace-{label}-{}",
                std::process::id()
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn perform(
        ws: &Workspace,
        name: &str,
        expected: (&str, &str),
        content: &str,
    ) -> Result<String, String> {
        edit(ws, Path::new(name), expected.0, expected.1, content, |_| {
            Ok(())
        })
    }

    #[test]
    fn publish_partial_sequence_and_rollback_only_the_confirmed_revision() {
        let _privilege =
            AuditPrivilege::enable().expect("Windows runner must allow reading fixture SACLs");
        let fixture = Fixture::new("sequence");
        for file in ["first", "second"] {
            fs::write(fixture.0.join(file), "original").unwrap();
        }
        let ws = Workspace::grant(&fixture.0).unwrap();
        let (_, first) = ws.snapshot(Path::new("first")).unwrap();
        let (_, second) = ws.snapshot(Path::new("second")).unwrap();
        let fault = edit(
            &ws,
            Path::new("first"),
            "original",
            &first,
            "unused",
            |_| Err(io::Error::other("injected failure before rename")),
        )
        .unwrap_err();
        assert!(fault.contains("injected failure before rename"), "{fault}");
        assert_eq!(
            ws.snapshot(Path::new("first")).unwrap(),
            ("original".into(), first.clone())
        );
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
        let published = perform(&ws, "first", ("original", &first), "replacement").unwrap();
        assert_eq!(
            ws.snapshot(Path::new("first")).unwrap(),
            ("replacement".into(), published.clone())
        );
        fs::write(fixture.0.join("second"), "external").unwrap();
        assert!(perform(&ws, "second", ("original", &second), "unused").is_err());
        assert_eq!(ws.read(Path::new("second")).unwrap(), "external");

        let restored = perform(&ws, "first", ("replacement", &published), "original").unwrap();
        assert_ne!(restored, first);
        assert!(perform(&ws, "first", ("replacement", &published), "original").is_err());
        let changed = perform(&ws, "first", ("original", &restored), "replacement").unwrap();

        // An external editor can replace the inode with identical bytes.
        fs::remove_file(fixture.0.join("first")).unwrap();
        fs::write(fixture.0.join("first"), "replacement").unwrap();
        assert!(perform(&ws, "first", ("replacement", &changed), "original").is_err());
        assert_eq!(ws.read(Path::new("first")).unwrap(), "replacement");
    }

    #[test]
    fn rejects_locks_links_streams_and_differing_acl_before_publication() {
        let _privilege =
            AuditPrivilege::enable().expect("Windows runner must allow reading fixture SACLs");
        let fixture = Fixture::new("metadata");
        let file = fixture.0.join("note.txt");
        fs::write(&file, "original").unwrap();
        let ws = Workspace::grant(&fixture.0).unwrap();
        let (_, revision) = ws.snapshot(Path::new("note.txt")).unwrap();
        let writer = fs::OpenOptions::new()
            .write(true)
            .share_mode(FILE_SHARE_READ)
            .open(&file)
            .unwrap();
        assert!(perform(&ws, "note.txt", ("original", &revision), "replacement").is_err());
        drop(writer);
        let verify = |name| perform(&ws, name, ("original", &revision), "replacement").is_err();
        std::os::windows::fs::symlink_file(&file, fixture.0.join("symbolic")).unwrap();
        assert!(verify("symbolic"));
        assert!(verify("../note.txt"));
        let nested = fixture.0.join("nested");
        let junction = fixture.0.join("junction");
        fs::create_dir(&nested).unwrap();
        fs::write(nested.join("note.txt"), "original").unwrap();
        let command_path = |path: &Path| {
            path.to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_owned()
        };
        assert!(Command::new("cmd")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(command_path(&junction))
            .arg(command_path(&nested))
            .status()
            .unwrap()
            .success());
        let (_, nested_revision) = ws.snapshot(Path::new("nested/note.txt")).unwrap();
        assert!(perform(
            &ws,
            "junction/note.txt",
            ("original", &nested_revision),
            "replacement"
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(nested.join("note.txt")).unwrap(),
            "original"
        );
        fs::remove_dir(junction).unwrap();
        fs::hard_link(&file, fixture.0.join("linked")).unwrap();
        assert!(verify("note.txt"));
        fs::remove_file(fixture.0.join("linked")).unwrap();

        let stream = fixture.0.join("note.txt:private");
        fs::write(&stream, "private stream").unwrap();
        let (_, current) = ws.snapshot(Path::new("note.txt")).unwrap();
        let refused = perform(&ws, "note.txt", ("original", &current), "replacement").unwrap_err();
        assert!(refused.contains("streams"), "{refused}");
        assert_eq!(fs::read_to_string(&stream).unwrap(), "private stream");
        fs::remove_file(&stream).unwrap();

        assert!(Command::new("icacls")
            .arg(&file)
            .arg("/inheritance:d")
            .status()
            .unwrap()
            .success());
        let (_, current) = ws.snapshot(Path::new("note.txt")).unwrap();
        let refused = perform(&ws, "note.txt", ("original", &current), "replacement").unwrap_err();
        assert!(refused.contains("DACL"), "{refused}");
        assert_eq!(fs::read_to_string(&file).unwrap(), "original");
        assert!(fs::read_dir(&fixture.0).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".nexus-win-edit-")));
    }

    #[test]
    fn refuses_replacement_when_the_original_has_a_distinct_audit_rule() {
        let _privilege =
            AuditPrivilege::enable().expect("Windows runner must allow reading fixture SACLs");
        let fixture = Fixture::new("sacl");
        let file = fixture.0.join("note");
        fs::write(&file, "original").unwrap();
        set_audit_rule(&file).unwrap();
        let ws = Workspace::grant(&fixture.0).unwrap();
        let (_, current) = ws.snapshot(Path::new("note")).unwrap();
        let refused = perform(&ws, "note", ("original", &current), "replacement").unwrap_err();
        assert!(refused.contains("SACL"), "{refused}");
        assert_eq!(
            ws.snapshot(Path::new("note")).unwrap(),
            ("original".into(), current)
        );
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }

    #[test]
    fn interruption_worker() {
        let Some(root) = std::env::var_os("NEXUS_WINDOWS_REPLACEMENT_TEST_ROOT") else {
            return;
        };
        let mode = std::env::var("NEXUS_WINDOWS_REPLACEMENT_TEST_MODE").unwrap();
        if mode == "external-probe" {
            let note = Path::new(&root).join("note");
            let rename = Path::new(&root).join("moved-note");
            assert!(fs::write(&note, "external write").is_err());
            assert!(fs::rename(&note, &rename).is_err());
            return;
        }
        let _privilege =
            AuditPrivilege::enable().expect("Windows runner must allow reading fixture SACLs");
        let ws = Workspace::grant(Path::new(&root)).unwrap();
        let (_, revision) = ws.snapshot(Path::new("note")).unwrap();
        edit(
            &ws,
            Path::new("note"),
            "original",
            &revision,
            "replacement",
            |point| {
                match point {
                    PublishPoint::Staged(_) if mode == "staging" => std::process::exit(31),
                    PublishPoint::Staged(receipt) if mode == "disarmed" => {
                        println!("STAGE_RECEIPT={}", serde_json::to_string(receipt).unwrap());
                        io::stdout().flush()?;
                    }
                    PublishPoint::Disarmed if mode == "disarmed" => std::process::exit(33),
                    _ => {}
                }
                Ok(())
            },
        )
        .unwrap();
        // Kill the worker after publication and before its caller sees a receipt.
        std::process::exit(32);
    }

    #[test]
    fn failed_publication_preserves_original_and_removes_disarmed_stage() {
        let _privilege =
            AuditPrivilege::enable().expect("Windows runner must allow reading fixture SACLs");
        let fixture = Fixture::new("blocked-publication");
        let path = fixture.0.join("note");
        fs::write(&path, "original").unwrap();
        let ws = Workspace::grant(&fixture.0).unwrap();
        let (_, original_revision) = ws.snapshot(Path::new("note")).unwrap();

        // A handle without FILE_SHARE_DELETE must prevent replacement. The
        // editor must fail closed, leave the original intact and clean up
        // the staging file even after its delete disposition was disarmed.
        let blocker = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(&path)
            .unwrap();
        let result = edit(
            &ws,
            Path::new("note"),
            "original",
            &original_revision,
            "replacement",
            |_| Ok(()),
        );
        assert!(result.is_err(), "a non-delete-sharing handle must block publication");
        drop(blocker);
        assert_eq!(
            ws.snapshot(Path::new("note")).unwrap(),
            ("original".into(), original_revision)
        );
        assert!(
            fs::read_dir(&fixture.0).unwrap().all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".nexus-win-edit-")),
            "failed publication must not leave an unreceipted staging file"
        );
    }

    #[test]
    fn holds_the_original_against_an_external_writer_at_the_final_checkpoint() {
        let _privilege =
            AuditPrivilege::enable().expect("Windows runner must allow reading fixture SACLs");
        let fixture = Fixture::new("external");
        fs::write(fixture.0.join("note"), "original").unwrap();
        let ws = Workspace::grant(&fixture.0).unwrap();
        let (_, original) = ws.snapshot(Path::new("note")).unwrap();
        let written = edit(
            &ws,
            Path::new("note"),
            "original",
            &original,
            "replacement",
            |point| {
                if matches!(point, PublishPoint::Disarmed) {
                    let child = Command::new(std::env::current_exe()?)
                        .args([
                            "--exact",
                            "windows::replacement::tests::interruption_worker",
                        ])
                        .env("NEXUS_WINDOWS_REPLACEMENT_TEST_ROOT", &fixture.0)
                        .env("NEXUS_WINDOWS_REPLACEMENT_TEST_MODE", "external-probe")
                        .status()?;
                    if !child.success() {
                        return Err(io::Error::other("External write or rename was not blocked"));
                    }
                }
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(
            ws.snapshot(Path::new("note")).unwrap(),
            ("replacement".into(), written)
        );
        assert!(!fixture.0.join("moved-note").exists());
    }

    #[test]
    fn cleans_only_the_receipted_stage_left_between_disarm_and_rename() {
        let fixture = Fixture::new("disarmed");
        fs::write(fixture.0.join("note"), "original").unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "windows::replacement::tests::interruption_worker",
                "--nocapture",
            ])
            .env("NEXUS_WINDOWS_REPLACEMENT_TEST_ROOT", &fixture.0)
            .env("NEXUS_WINDOWS_REPLACEMENT_TEST_MODE", "disarmed")
            .output()
            .unwrap();
        assert_eq!(
            output.status.code(),
            Some(33),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        let encoded = stdout
            .lines()
            .find_map(|line| line.strip_prefix("STAGE_RECEIPT="))
            .unwrap();
        let receipt: StageReceipt = serde_json::from_str(encoded).unwrap();
        let ws = Workspace::grant(&fixture.0).unwrap();
        let staged = fixture.0.join(&receipt.name);
        assert_eq!(fs::read_to_string(&staged).unwrap(), "replacement");

        let swapped = fixture.0.join("unrelated");
        fs::rename(&staged, &swapped).unwrap();
        fs::write(&staged, "unrelated").unwrap();
        assert!(discard_stage(&ws, &receipt, "replacement").is_err());
        assert_eq!(fs::read_to_string(&staged).unwrap(), "unrelated");
        fs::remove_file(&staged).unwrap();
        fs::rename(swapped, &staged).unwrap();
        fs::write(&staged, "external edit of the staging file").unwrap();
        assert!(discard_stage(&ws, &receipt, "replacement").is_err());
        assert_eq!(
            fs::read_to_string(&staged).unwrap(),
            "external edit of the staging file"
        );
        fs::write(&staged, "replacement").unwrap();
        discard_stage(&ws, &receipt, "replacement").unwrap();
        assert!(!staged.exists());
        assert_eq!(
            fs::read_to_string(fixture.0.join("note")).unwrap(),
            "original"
        );
    }

    #[test]
    fn interrupted_staging_and_missing_receipt_leave_inspectable_state() {
        let fixture = Fixture::new("interrupt");
        fs::write(fixture.0.join("note"), "original").unwrap();
        for (mode, status, contents) in [
            ("staging", 31, "original"),
            ("published", 32, "replacement"),
        ] {
            let child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "windows::replacement::tests::interruption_worker",
                ])
                .env("NEXUS_WINDOWS_REPLACEMENT_TEST_ROOT", &fixture.0)
                .env("NEXUS_WINDOWS_REPLACEMENT_TEST_MODE", mode)
                .status()
                .unwrap();
            assert_eq!(child.code(), Some(status));
            assert_eq!(
                fs::read_to_string(fixture.0.join("note")).unwrap(),
                contents
            );
            assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
        }
    }
}
