use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
};

#[test]
fn rejects_malformed_frames_and_stops_on_oversized_input() {
    let root = std::env::current_dir().unwrap();
    let mut host = Command::new(env!("CARGO_BIN_EXE_nexus-workspace"))
        .arg(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut output = BufReader::new(host.stdout.take().unwrap()).lines();
    assert_eq!(
        serde_json::from_str::<Value>(&output.next().unwrap().unwrap()).unwrap()["ready"],
        true
    );
    let mut input = host.stdin.take().unwrap();
    for request in [
        "broken",
        r#"{"version":2,"operation":"read","path":"Cargo.toml"}"#,
        r#"{"version":1,"operation":"exec","path":""}"#,
    ] {
        writeln!(input, "{request}").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&output.next().unwrap().unwrap()).unwrap()["ok"],
            false
        );
    }
    let _ = input.write_all(&vec![b'x'; 600_001]);
    drop(input);
    assert!(output.next().is_none());
    assert!(host.wait().unwrap().success());
}

#[cfg(target_os = "linux")]
#[test]
fn failed_and_interrupted_staging_leave_original_and_allow_retry() {
    use serde_json::json;
    use std::{fs, os::unix::process::CommandExt};

    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("nexus-edit-failure-{}", std::process::id()));
    fs::create_dir(&root).unwrap();
    fs::write(root.join("note"), "old").unwrap();
    let ws = nexus_workspace::Workspace::grant(&root).unwrap();
    let (_, revision) = ws.snapshot("note".as_ref()).unwrap();
    let request = json!({"version":1,"operation":"edit","path":"note","expected":"old","revision":revision,"content":"new content"});

    for crash in [false, true] {
        let mut command = Command::new(env!("CARGO_BIN_EXE_nexus-workspace"));
        command
            .arg(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped());
        // RLIMIT_FSIZE permits one byte of the staging file, then forces a
        // write error or terminates the child exactly during staging.
        unsafe {
            command.pre_exec(move || {
                libc::signal(
                    libc::SIGXFSZ,
                    if crash { libc::SIG_DFL } else { libc::SIG_IGN },
                );
                let limit = libc::rlimit {
                    rlim_cur: 1,
                    rlim_max: 1,
                };
                if libc::setrlimit(libc::RLIMIT_FSIZE, &limit) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        let mut host = command.spawn().unwrap();
        writeln!(host.stdin.take().unwrap(), "{request}").unwrap();
        let output = host.wait_with_output().unwrap();
        if crash {
            use std::os::unix::process::ExitStatusExt;
            assert_eq!(output.status.signal(), Some(libc::SIGXFSZ));
        } else {
            assert!(output.status.success());
            let reply: Value = serde_json::from_str(
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .last()
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(reply["ok"], false);
            assert_eq!(reply["message"], "Cannot write temporary file");
            assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        }
        assert_eq!(fs::read_to_string(root.join("note")).unwrap(), "old");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
    }
    let unrelated = root.join(".nexus-edit-00000000000000000000000000000000");
    fs::write(&unrelated, "unrelated existing file").unwrap();
    ws.edit_checked("note".as_ref(), "old", &revision, "recovered")
        .unwrap();
    assert_eq!(fs::read_to_string(root.join("note")).unwrap(), "recovered");
    assert_eq!(
        fs::read_to_string(unrelated).unwrap(),
        "unrelated existing file"
    );
    fs::remove_dir_all(root).unwrap();
}
