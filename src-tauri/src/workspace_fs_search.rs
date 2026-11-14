use crate::workspace_fs::open_regular_file_readonly;
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::State;

const MAX_SEARCH_FILES: usize = 500;
const MAX_SEARCH_RESULTS: usize = 100;
const MAX_SEARCH_DEPTH: usize = 12;
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PREVIEW_CHARS: usize = 240;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContentMatch {
    path: String,
    line_number: usize,
    preview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContentSearch {
    matches: Vec<WorkspaceContentMatch>,
    total_matches: usize,
    scanned_files: usize,
    truncated: bool,
}

fn excluded_directory(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "target" | "dist" | ".next" | ".cache" | "vendor")
}

fn search_contents_in(root: &Path, start: &Path, query: &str) -> Result<WorkspaceContentSearch, String> {
    if query.trim().is_empty() || query.len() > 256 {
        return Err("Search query must contain 1 to 256 characters.".into());
    }
    let canonical_root = fs::canonicalize(root).map_err(|e| format!("Could not resolve approved root: {e}"))?;
    let canonical_start = fs::canonicalize(start).map_err(|e| format!("Could not open search directory: {e}"))?;
    if !canonical_start.is_dir() || !canonical_start.starts_with(&canonical_root) {
        return Err("Search location is not inside an approved directory.".into());
    }

    let needle = query.to_lowercase();
    let mut pending: Vec<(PathBuf, usize)> = vec![(canonical_start, 0)];
    let mut matches_found = Vec::new();
    let mut scanned_files = 0usize;
    let mut total_matches = 0usize;
    let mut truncated = false;

    'walk: while let Some((directory, depth)) = pending.pop() {
        let iterator = match fs::read_dir(&directory) {
            Ok(value) => value,
            Err(_) => { truncated = true; continue; },
        };
        let mut entries: Vec<_> = iterator.filter_map(std::result::Result::ok).collect();
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            let entry_path = entry.path();
            let link_metadata = match fs::symlink_metadata(&entry_path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if link_metadata.file_type().is_symlink() { continue; }

            let name = entry.file_name().to_string_lossy().into_owned();
            let canonical = match fs::canonicalize(&entry_path) {
                Ok(value) if value.starts_with(&canonical_root) => value,
                _ => continue,
            };
            let metadata = match fs::metadata(&canonical) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if metadata.is_dir() {
                if !excluded_directory(&name) {
                    if depth < MAX_SEARCH_DEPTH {
                        pending.push((canonical, depth + 1));
                    } else {
                        truncated = true;
                    }
                }
                continue;
            }
            if !metadata.is_file() { continue; }

            if scanned_files >= MAX_SEARCH_FILES {
                truncated = true;
                break 'walk;
            }
            scanned_files += 1;
            if metadata.len() > MAX_FILE_BYTES { continue; }

            // Open the original directory entry, not its canonicalized target:
            // a final-component symlink substituted after the preflight must fail.
            let file = match open_regular_file_readonly(&entry_path) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let opened_metadata = match file.metadata() {
                Ok(value) if value.is_file() => value,
                _ => continue,
            };
            if opened_metadata.len() > MAX_FILE_BYTES { continue; }
            let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
            if file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).is_err() || bytes.len() as u64 > MAX_FILE_BYTES {
                continue;
            }
            let content = match String::from_utf8(bytes) {
                Ok(value) => value,
                Err(_) => continue,
            };

            for (index, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    total_matches += 1;
                    if matches_found.len() < MAX_SEARCH_RESULTS {
                        let preview: String = line.trim().chars().take(MAX_PREVIEW_CHARS).collect();
                        matches_found.push(WorkspaceContentMatch {
                            path: canonical.to_string_lossy().into_owned(),
                            line_number: index + 1,
                            preview,
                        });
                    } else {
                        // Keep counting within the bounded file/size/depth budget so
                        // total_matches remains exact for the scanned search scope.
                        truncated = true;
                    }
                }
            }
        }
    }

    if scanned_files >= MAX_SEARCH_FILES && !pending.is_empty() { truncated = true; }
    Ok(WorkspaceContentSearch { matches: matches_found, total_matches, scanned_files, truncated })
}

#[tauri::command]
pub fn search_workspace_contents(
    path: String,
    query: String,
    access: State<'_, crate::workspace_fs::WorkspaceAccess>,
) -> Result<WorkspaceContentSearch, String> {
    let root = access.allowed_root_for(Path::new(&path))?;
    search_contents_in(&root, Path::new(&path), &query)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .expect("clock").as_nanos();
        let root = std::env::temp_dir().join(format!("nexus-content-search-{label}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&root).expect("create temporary root");
        root
    }

    #[test]
    fn finds_matching_lines_with_one_based_line_numbers() {
        let root = temporary_root("matches");
        fs::create_dir_all(root.join("notes")).expect("create nested folder");
        fs::write(root.join("notes").join("readme.txt"), "first line\nNEXUS is ready\nlast line").expect("write file");
        let result = search_contents_in(&root, &root, "nexus").expect("search");
        assert_eq!(result.total_matches, 1);
        assert_eq!(result.matches[0].line_number, 2);
        assert_eq!(result.matches[0].preview, "NEXUS is ready");
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn skips_binary_files_and_excluded_directories() {
        let root = temporary_root("excluded");
        fs::create_dir_all(root.join("node_modules")).expect("create excluded folder");
        fs::write(root.join("binary.dat"), [0xff, 0xfe, 0xfd]).expect("write binary");
        fs::write(root.join("node_modules").join("hidden.txt"), "needle").expect("write excluded file");
        fs::write(root.join("visible.txt"), "visible needle").expect("write visible file");
        let result = search_contents_in(&root, &root, "needle").expect("search");
        assert_eq!(result.total_matches, 1);
        assert!(result.matches[0].path.ends_with("visible.txt"));
        fs::remove_dir_all(root).expect("cleanup");
    }


    #[cfg(unix)]
    #[test]
    fn content_search_never_reads_through_a_symbolic_link() {
        use std::os::unix::fs::symlink;
        let root = temporary_root("symlink-root");
        let outside = temporary_root("symlink-outside");
        let secret = outside.join("private.txt");
        fs::write(&secret, "needle must not be indexed").expect("write outside file");
        symlink(&secret, root.join("linked.txt")).expect("create file symlink");

        let result = search_contents_in(&root, &root, "needle").expect("search approved root");
        assert_eq!(result.total_matches, 0);
        assert!(result.matches.is_empty());

        fs::remove_dir_all(root).expect("cleanup approved root");
        fs::remove_dir_all(outside).expect("cleanup outside root");
    }

    #[test]
    fn counts_all_matches_while_retaining_only_the_first_hundred() {
        let root = temporary_root("result-limit");
        let content = (0..125).map(|index| format!("needle {index}")).collect::<Vec<_>>().join("\n");
        fs::write(root.join("many.txt"), content).expect("write file");
        let result = search_contents_in(&root, &root, "needle").expect("search");
        assert_eq!(result.total_matches, 125);
        assert_eq!(result.matches.len(), MAX_SEARCH_RESULTS);
        assert!(result.truncated);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_empty_queries_and_paths_outside_the_root() {
        let root = temporary_root("validation");
        assert!(search_contents_in(&root, &root, "  ").is_err());
        let outside = temporary_root("outside");
        assert!(search_contents_in(&root, &outside, "needle").is_err());
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }
}
