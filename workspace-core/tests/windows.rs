#![cfg(windows)]

use nexus_workspace::Workspace;
use std::{fs, os::windows::fs::OpenOptionsExt, path::Path, process::Command};

fn fixture(name: &str) -> std::path::PathBuf {
    let base = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("nexus-windows-{name}-{}", std::process::id()));
    fs::create_dir(&base).unwrap();
    base
}

#[test]
fn refuses_junctions_symlinks_streams_and_hard_links() {
    let base = fixture("links");
    let root = base.join("project");
    let outside = base.join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("note.txt"), "outside").unwrap();
    fs::write(root.join("note.txt"), "inside").unwrap();

    // Use non-verbatim paths for the Windows command interpreter.
    let command_path = |path: &Path| {
        path.to_str()
            .unwrap()
            .strip_prefix(r"\\?\")
            .unwrap_or(path.to_str().unwrap())
            .to_string()
    };
    assert!(Command::new("cmd")
        .args(["/d", "/c", "mklink", "/J"])
        .arg(command_path(&root.join("junction")))
        .arg(command_path(&outside))
        .status()
        .unwrap()
        .success());
    std::os::windows::fs::symlink_file(root.join("note.txt"), root.join("alias.txt"))
        .expect("Windows test runner must allow symlink creation");
    fs::hard_link(root.join("note.txt"), outside.join("linked.txt")).unwrap();

    let workspace = Workspace::grant(&root).unwrap();
    assert!(Workspace::grant(&root.join("junction")).is_err());
    assert!(workspace.directory(Path::new("junction")).is_err());
    for path in [
        "../outside/note.txt",
        "junction/note.txt",
        "alias.txt",
        "note.txt",
        "note.txt:stream",
    ] {
        assert!(workspace.read(Path::new(path)).is_err(), "{path}");
        assert!(workspace.snapshot(Path::new(path)).is_err(), "{path}");
    }
    assert_eq!(
        fs::read_to_string(outside.join("note.txt")).unwrap(),
        "outside"
    );
    drop(workspace);
    fs::remove_dir(root.join("junction")).unwrap();
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn revisions_detect_same_byte_replacements_and_locked_files_fail_closed() {
    let root = fixture("revisions");
    let path = root.join("note");
    fs::write(&path, "same bytes").unwrap();
    let workspace = Workspace::grant(&root).unwrap();
    let (_, original) = workspace.snapshot(Path::new("note")).unwrap();
    let replacement = root.join("replacement");
    fs::write(&replacement, "same bytes").unwrap();
    fs::remove_file(&path).unwrap();
    fs::rename(replacement, &path).unwrap();
    let (text, replaced) = workspace.snapshot(Path::new("note")).unwrap();
    assert_eq!(text, "same bytes");
    assert_ne!(original, replaced);

    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert!(workspace.snapshot(Path::new("note")).is_err());
    drop(locked);
    assert_eq!(workspace.snapshot(Path::new("note")).unwrap().1, replaced);
    drop(workspace);
    fs::remove_dir_all(root).unwrap();
}
