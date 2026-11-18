//! One granted directory per process. Closing stdin revokes the session.
use nexus_workspace::{read_text, Workspace};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Read, Write},
    path::Path,
};
const MAX_REQUEST_BYTES: usize = 600_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u8,
    operation: Operation,
    path: String,
    query: Option<String>,
    #[cfg(target_os = "linux")]
    expected: Option<String>,
    #[cfg(target_os = "linux")]
    revision: Option<String>,
    #[cfg(target_os = "linux")]
    content: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Operation {
    Read,
    Edit,
    List,
    Search,
}
fn walk(
    dir: &cap_std::fs::Dir,
    prefix: &str,
    query: Option<&str>,
    depth: usize,
    budget: &mut usize,
    entries: &mut Vec<String>,
) -> Result<(), String> {
    for entry in dir.entries().map_err(|_| "Cannot list directory")? {
        if *budget == 0 || entries.len() >= 100 {
            break;
        }
        *budget -= 1;
        let entry = entry.map_err(|_| "Cannot inspect entry")?;
        let name = entry.file_name();
        let Some(label) = name.to_str() else { continue };
        let path = format!("{prefix}{label}");
        let kind = entry.file_type().map_err(|_| "Cannot inspect entry")?;
        if let Some(q) = query {
            if kind.is_dir() && depth < 8 {
                use cap_fs_ext::DirExt;
                if let Ok(child) = dir.open_dir_nofollow(&name) {
                    walk(
                        &child,
                        &format!("{path}/"),
                        query,
                        depth + 1,
                        budget,
                        entries,
                    )?
                }
            } else if kind.is_file() && read_text(dir, &name, 48000).is_ok_and(|s| s.contains(q)) {
                entries.push(path)
            }
        } else if kind.is_file() || kind.is_dir() {
            entries.push(path)
        }
    }
    Ok(())
}
fn execute(ws: &Workspace, line: &[u8]) -> Result<Value, String> {
    let r: Request = serde_json::from_slice(line).map_err(|_| "Malformed workspace request")?;
    if r.version != 1 || r.path.len() > 4096 {
        return Err("Invalid version or path".into());
    }
    let path = Path::new(&r.path);
    match r.operation {
        Operation::Read => {
            #[cfg(target_os = "linux")]
            {
                let (content, revision) = ws.snapshot(path)?;
                Ok(json!({"content":content,"revision":revision}))
            }
            #[cfg(not(target_os = "linux"))]
            Ok(json!({"content":ws.read(path)?}))
        }
        Operation::Edit => {
            #[cfg(target_os = "linux")]
            {
                let revision = r
                    .revision
                    .as_deref()
                    .filter(|value| value.len() <= 128)
                    .ok_or("Missing or invalid revision")?;
                ws.edit_checked(
                    path,
                    r.expected.as_deref().ok_or("Missing original content")?,
                    revision,
                    r.content.as_deref().ok_or("Missing replacement content")?,
                )?;
                Ok(json!({"applied":true}))
            }
            #[cfg(not(target_os = "linux"))]
            Err("Applying drafts is supported only on Linux".into())
        }
        Operation::List | Operation::Search => {
            let query = if matches!(r.operation, Operation::Search) {
                Some(
                    r.query
                        .as_deref()
                        .filter(|q| !q.is_empty() && q.len() <= 256)
                        .ok_or("Invalid search query")?,
                )
            } else {
                None
            };
            let mut entries = Vec::new();
            walk(&ws.directory(path)?, "", query, 0, &mut 1000, &mut entries)?;
            Ok(json!({"entries":entries}))
        }
    }
}
fn main() -> io::Result<()> {
    let root = std::env::args_os()
        .nth(1)
        .ok_or(io::ErrorKind::InvalidInput)?;
    let ws = Workspace::grant(Path::new(&root)).map_err(io::Error::other)?;
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    writeln!(
        output,
        "{}",
        json!({"version":1,"ready":true,"edit":cfg!(target_os = "linux")})
    )?;
    output.flush()?;
    loop {
        let mut line = Vec::new();
        if (&mut input)
            .take((MAX_REQUEST_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)?
            == 0
        {
            break;
        }
        if line.len() > MAX_REQUEST_BYTES || line.last() != Some(&b'\n') {
            break;
        }
        let mut reply = match execute(&ws, &line) {
            Ok(value) => json!({"version":1,"ok":true,"value":value}),
            Err(e) => json!({"version":1,"ok":false,"message":e}),
        }
        .to_string();
        if reply.len() > 64000 {
            reply = json!({"version":1,"ok":false,"message":"Output limit exceeded"}).to_string()
        }
        writeln!(output, "{reply}")?;
        output.flush()?;
    }
    Ok(())
}
