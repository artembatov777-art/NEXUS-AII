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

const MAX_PATH_LENGTH = 4096;
const MAX_TOOL_TEXT_BYTES = 48_000;
const MAX_LIST_ENTRIES = 100;

function validPathInput(input: unknown): Result<PathInput> {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof (input as Record<string, unknown>).path !== "string") {
    return err("validation", "A workspace path is required.");
  }
  const path = (input as { path: string }).path;
  if (!path.trim() || path.length > MAX_PATH_LENGTH) return err("validation", "Workspace path must contain 1 to 4,096 characters.");
  return ok({ path });
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
      execute: async ({ path }, context) => {
        if (!nativeCheck.ok) return nativeCheck;
        if (context.signal.aborted) return err("cancelled", "Workspace listing was cancelled.");
        try {
          const entries = await invoke<WorkspaceEntry[]>("list_workspace_entries", { path });
          if (context.signal.aborted) return err("cancelled", "Workspace listing was cancelled.");
          return ok({ path, entries: entries.slice(0, MAX_LIST_ENTRIES), totalEntries: entries.length, truncated: entries.length > MAX_LIST_ENTRIES });
        } catch (cause) { return failure(cause, "Could not list the approved workspace directory."); }
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
          const truncated = new TextEncoder().encode(content).byteLength > MAX_TOOL_TEXT_BYTES;
          let bounded = content;
          if (truncated) {
            let end = Math.min(content.length, MAX_TOOL_TEXT_BYTES);
            while (new TextEncoder().encode(content.slice(0, end)).byteLength > MAX_TOOL_TEXT_BYTES) end -= 1024;
            bounded = content.slice(0, end);
          }
          return ok({ path, content: bounded, truncated, totalCharacters: content.length });
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
