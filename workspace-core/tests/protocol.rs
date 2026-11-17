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
    input.write_all(&vec![b'x'; 8193]).unwrap();
    assert!(output.next().is_none());
    assert!(host.wait().unwrap().success());
}
