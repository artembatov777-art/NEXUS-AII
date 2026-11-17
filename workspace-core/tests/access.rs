use nexus_workspace::Workspace;
use std::{fs, path::Path};
#[test]
fn bounded_read_from_granted_directory() {
    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("nexus-access-{}", std::process::id()));
    fs::create_dir(&root).unwrap();
    fs::write(root.join("note"), "hello").unwrap();
    let workspace = Workspace::grant(&root).unwrap();
    assert_eq!(workspace.read(Path::new("note")).unwrap(), "hello");
    assert!(workspace.read(Path::new("../note")).is_err());
    assert!(workspace.read(&root.join("note")).is_err());
    fs::write(root.join("large"), vec![0; 48001]).unwrap();
    assert!(workspace.read(Path::new("large")).is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("note"), root.join("alias")).unwrap();
        assert!(workspace.read(Path::new("alias")).is_err());
    }
    drop(workspace);
    fs::remove_dir_all(root).unwrap();
}

#[cfg(unix)]
#[test]
fn replacing_the_project_path_does_not_retarget_a_session() {
    let base = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("nexus-pinned-{}", std::process::id()));
    fs::create_dir(&base).unwrap();
    let root = base.join("root");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("note"), "approved").unwrap();
    let ws = Workspace::grant(&root).unwrap();
    fs::rename(&root, base.join("original")).unwrap();
    fs::create_dir(&root).unwrap();
    fs::write(root.join("note"), "replacement").unwrap();
    assert_eq!(ws.read(Path::new("note")).unwrap(), "approved");
    fs::hard_link(base.join("original/note"), base.join("linked")).unwrap();
    assert!(ws.read(Path::new("note")).is_err());
    fs::remove_dir_all(base).unwrap();
}

#[cfg(unix)]
#[test]
fn intermediate_symlinks_and_hard_links_are_refused() {
    use std::os::unix::fs::symlink;
    let base = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("nexus-links-{}", std::process::id()));
    fs::create_dir(&base).unwrap();
    let root = base.join("root");
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("inside")).unwrap();
    fs::write(root.join("inside/file"), "data").unwrap();
    symlink(root.join("inside"), root.join("alias")).unwrap();
    let workspace = Workspace::grant(&root).unwrap();
    assert!(workspace.read(Path::new("alias/file")).is_err());
    fs::hard_link(root.join("inside/file"), base.join("outside-link")).unwrap();
    assert!(workspace.read(Path::new("inside/file")).is_err());
    drop(workspace);
    fs::remove_dir_all(base).unwrap();
}
