import { invoke, isTauri } from "@tauri-apps/api/core";
import { err, ok, type Result } from "../core/result";
import type { ToolDefinition } from "../core/tools";
import type { ToolRegistry } from "../core/toolRegistry";

type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "directory" | "file" | "other";
  sizeBytes: number;
  modifiedAtMs: number | null;
};

type PathInput = { path: string };
type WriteInput = { path: string; content: string };
type SearchInput = { path: string; query: string };

const MAX_PATH_LENGTH = 4096;
const MAX_TOOL_TEXT_BYTES = 48_000;
const MAX_LIST_ENTRIES = 10;
const MAX_SERIALIZED_OUTPUT_BYTES = 60_000;

function validPathInput(input: unknown): Result<PathInput> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof (input as Record<string, unknown>).path !== "string") {
    return err("validation", "A workspace path is required.");
  }
  const path = (input as { path: string }).path;
  if (!path.trim() || path.length > MAX_PATH_LENGTH) return err("validation", "Workspace path must contain 1 to 4,096 characters.");
  return ok({ path });
}

function validSearchInput(input: unknown): Result<SearchInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return err("validation", "A workspace path and search query are required.");
  const record = input as Record<string, unknown>;
  if (typeof record.path !== "string" || !record.path.trim() || record.path.length > MAX_PATH_LENGTH ||
      typeof record.query !== "string" || !record.query.trim() || record.query.length > 256) {
    return err("validation", "Workspace path or search query is invalid.");
  }
  return ok({ path: record.path, query: record.query.trim() });
}

function validWriteInput(input: unknown): Result<WriteInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return err("validation", "A file path and text content are required.");
  const record = input as Record<string, unknown>;
  if (typeof record.path !== "string" || !record.path.trim() || record.path.length > MAX_PATH_LENGTH ||
      typeof record.content !== "string" || new TextEncoder().encode(record.content).byteLength > MAX_TOOL_TEXT_BYTES) {
    return err("validation", "File path is invalid or content exceeds the 48 KB agent-write limit.");
  }
  return ok({ path: record.path, content: record.content });
}

function failure(cause: unknown, fallback: string): Result<never> {
  return err("tool_failed", cause instanceof Error ? cause.message : fallback);
}

function ensureNative(): Result<void> {
  return isTauri() ? ok(undefined) : err("permission_denied", "Workspace tools are available only in the NEXUS desktop app.");
}

/** Registers narrowly scoped filesystem tools. Native Rust commands remain the final access-control boundary. */
export function registerWorkspaceTools(registry: ToolRegistry): Result<void> {
  const nativeCheck = ensureNative();
  const definitions: ToolDefinition<any, any>[] = [
    {
      id: "workspace.list",
      version: "1.0.0",
      description: "List files and folders inside a directory explicitly approved by the owner. Input: {path}.",
      requiredPermissions: ["filesystem:read:selected"],
      risk: "low",
      timeoutMs: 15_000,
      validateInput: validPathInput,
      resourceForInput: input => input.path,
      execute: async ({ path }, context) => {
        if (!nativeCheck.ok) return nativeCheck;
        if (context.signal.aborted) return err("cancelled", "Workspace listing was cancelled.");
        try {
          const entries = await invoke<WorkspaceEntry[]>("list_workspace_entries", { path });
          if (context.signal.aborted) return err("cancelled", "Workspace listing was cancelled.");
          let visible = entries.slice(0, MAX_LIST_ENTRIES);
          while (visible.length > 0 && new TextEncoder().encode(JSON.stringify({
            path, entries: visible, totalEntries: entries.length, truncated: visible.length < entries.length
          })).byteLength > MAX_SERIALIZED_OUTPUT_BYTES) visible = visible.slice(0, -1);
          return ok({ path, entries: visible, totalEntries: entries.length, truncated: visible.length < entries.length });
        } catch (cause) { return failure(cause, "Could not list the approved workspace directory."); }
      }
    },
    {
      id: "workspace.search",
      version: "1.0.0",
      description: "Search file and folder names recursively inside an explicitly approved directory. Input: {path,query}. Search is bounded by depth and entry limits.",
      requiredPermissions: ["filesystem:read:selected"],
      risk: "low",
      timeoutMs: 15_000,
      validateInput: validSearchInput,
      resourceForInput: input => input.path,
      execute: async ({ path, query }, context) => {
        if (!nativeCheck.ok) return nativeCheck;
        if (context.signal.aborted) return err("cancelled", "Workspace search was cancelled.");
        try {
          const entries = await invoke<WorkspaceEntry[]>("search_workspace_entries", { path, query });
          if (context.signal.aborted) return err("cancelled", "Workspace search was cancelled.");
          return ok({ path, query, entries: entries.slice(0, 10), matchedEntries: entries.length, truncated: entries.length > 10 });
        } catch (cause) { return failure(cause, "Could not search the approved workspace directory."); }
      }
    },
    {
      id: "workspace.read",
      version: "1.0.0",
      description: "Read a UTF-8 text file inside an explicitly approved directory. Input: {path}. Output is capped at 48 KB.",
      requiredPermissions: ["filesystem:read:selected"],
      risk: "medium",
      timeoutMs: 15_000,
      validateInput: validPathInput,
      execute: async ({ path }, context) => {
        if (!nativeCheck.ok) return nativeCheck;
        if (context.signal.aborted) return err("cancelled", "Workspace read was cancelled.");
        try {
          const content = await invoke<string>("read_workspace_file", { path });
          if (context.signal.aborted) return err("cancelled", "Workspace read was cancelled.");
          const maxContentBytes = new TextEncoder().encode(content).byteLength;
          let low = 0;
          let high = Math.min(content.length, MAX_TOOL_TEXT_BYTES);
          let best = 0;
          while (low <= high) {
            let middle = Math.floor((low + high) / 2);
            const candidate = content.slice(0, middle);
            const output = { path, content: candidate, truncated: middle < content.length, totalCharacters: content.length };
            const size = new TextEncoder().encode(JSON.stringify(output)).byteLength;
            if (size <= MAX_SERIALIZED_OUTPUT_BYTES) {
              best = middle;
              low = middle + 1;
            } else {
              high = middle - 1;
            }
          }
          if (best > 0 && best < content.length) {
            const code = content.charCodeAt(best - 1);
            if (code >= 0xD800 && code <= 0xDBFF) best -= 1;
          }
          const bounded = content.slice(0, best);
          return ok({ path, content: bounded, truncated: best < content.length || maxContentBytes > MAX_TOOL_TEXT_BYTES, totalCharacters: content.length });
        } catch (cause) { return failure(cause, "Could not read the approved workspace file."); }
      }
    },
    {
      id: "workspace.write",
      version: "1.0.0",
      description: "Create or replace a UTF-8 text file inside an explicitly approved directory. Input: {path,content}, maximum 48 KB. Never deletes files.",
      requiredPermissions: ["filesystem:write:selected"],
      risk: "high",
      timeoutMs: 15_000,
      validateInput: validWriteInput,
      resourceForInput: input => input.path,
      execute: async ({ path, content }, context) => {
        if (!nativeCheck.ok) return nativeCheck;
        if (context.signal.aborted) return err("cancelled", "Workspace write was cancelled.");
        try {
          await invoke("write_workspace_file", { path, content });
          return ok({ path, saved: true, bytes: new TextEncoder().encode(content).byteLength });
        } catch (cause) { return failure(cause, "Could not write the approved workspace file."); }
      }
    },
    {
      id: "workspace.mkdir",
      version: "1.0.0",
      description: "Create a new directory inside an explicitly approved workspace directory. Input: {path}.",
      requiredPermissions: ["filesystem:write:selected"],
      risk: "medium",
      timeoutMs: 15_000,
      validateInput: validPathInput,
      execute: async ({ path }, context) => {
        if (!nativeCheck.ok) return nativeCheck;
        if (context.signal.aborted) return err("cancelled", "Directory creation was cancelled.");
        try {
          await invoke("create_workspace_directory", { path });
          return ok({ path, created: true });
        } catch (cause) { return failure(cause, "Could not create the approved workspace directory."); }
      }
    }
  ];

  for (const definition of definitions) {
    const registered = registry.register(definition, "builtin", ["filesystem", "workspace", "desktop"]);
    if (!registered.ok) return registered;
  }
  return ok(undefined);
}
