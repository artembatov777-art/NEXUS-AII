export interface WorkspaceKnowledgeFile {
  name: string;
  path: string;
  sizeBytes: number;
}

export interface WorkspaceKnowledgeScan {
  files: WorkspaceKnowledgeFile[];
  visitedEntries: number;
  skippedFiles: number;
  totalBytes: number;
  truncated: boolean;
}

type WorkspaceEntry = { name: string; path: string; kind: string; sizeBytes: number };
type WorkspaceInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "mdx", "csv", "json", "jsonl", "ndjson", "log", "yaml", "yml", "xml",
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs",
  "rb", "php", "sh", "ps1", "sql", "toml", "ini", "conf", "properties"
]);
const MAX_DEPTH = 10;
const MAX_ENTRIES = 5_000;
const MAX_FILES = 100;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
  return isWindowsPath ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedCandidate = normalizePath(candidate);
  return normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(normalizedRoot.endsWith("/") ? normalizedRoot : normalizedRoot + "/");
}

/** Walks only the already-approved native workspace root and returns bounded text files. */
export async function collectWorkspaceKnowledgeFiles(root: string, invoke: WorkspaceInvoke): Promise<WorkspaceKnowledgeScan> {
  if (!root.trim() || root.length > 4096) throw new Error("Choose a valid approved workspace directory.");
  const pending: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  const visitedDirectories = new Set<string>();
  const files: WorkspaceKnowledgeFile[] = [];
  let visitedEntries = 0;
  let skippedFiles = 0;
  let totalBytes = 0;
  let truncated = false;

  while (pending.length > 0) {
    const current = pending.pop()!;
    const key = normalizePath(current.path);
    if (visitedDirectories.has(key)) continue;
    visitedDirectories.add(key);
    const raw = await invoke("list_workspace_entries", { path: current.path });
    if (!Array.isArray(raw)) throw new Error("Workspace directory listing returned invalid data.");
    for (const value of raw) {
      visitedEntries += 1;
      if (visitedEntries > MAX_ENTRIES) { truncated = true; break; }
      if (!value || typeof value !== "object") { skippedFiles += 1; continue; }
      const entry = value as Partial<WorkspaceEntry>;
      if (typeof entry.name !== "string" || typeof entry.path !== "string" ||
          typeof entry.kind !== "string" || typeof entry.sizeBytes !== "number" ||
          !Number.isFinite(entry.sizeBytes) || entry.sizeBytes < 0 || !isWithinRoot(root, entry.path)) {
        skippedFiles += 1;
        continue;
      }
      if (entry.kind === "directory") {
        if (current.depth < MAX_DEPTH) pending.push({ path: entry.path, depth: current.depth + 1 });
        else truncated = true;
        continue;
      }
      if (entry.kind !== "file") { skippedFiles += 1; continue; }
      const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_EXTENSIONS.has(extension) || entry.sizeBytes > MAX_FILE_BYTES) {
        skippedFiles += 1;
        continue;
      }
      if (files.length >= MAX_FILES || totalBytes + entry.sizeBytes > MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      files.push({ name: entry.name, path: entry.path, sizeBytes: entry.sizeBytes });
      totalBytes += entry.sizeBytes;
    }
    if (truncated && (visitedEntries > MAX_ENTRIES || files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES)) break;
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, visitedEntries: Math.min(visitedEntries, MAX_ENTRIES), skippedFiles, totalBytes, truncated };
}
