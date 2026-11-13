// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, isTauri: isTauriMock }));

import { ToolGateway } from "../core/tools";
import { ToolRegistry } from "../core/toolRegistry";
import { registerWorkspaceTools } from "./workspaceTools";

function setup() {
  const permissions = { authorize: vi.fn().mockResolvedValue("allow") };
  const audit = { record: vi.fn().mockResolvedValue({ ok: true, value: undefined }) };
  const gateway = new ToolGateway(permissions, audit, { now: () => 1 });
  return { gateway, registry: new ToolRegistry(gateway), permissions, audit };
}

describe("workspace agent tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
  });

  it("registers list, read, write and mkdir tools with scoped permissions", () => {
    const { registry } = setup();
    expect(registerWorkspaceTools(registry).ok).toBe(true);
    const search = registry.search("", 20);
    expect(search.ok).toBe(true);
    if (search.ok) expect(search.value.map(tool => tool.id)).toEqual([
      "workspace.list", "workspace.search", "workspace.search_content", "workspace.read", "workspace.write", "workspace.mkdir", "workspace.rename", "workspace.move"
    ]);
  });

  it("fails closed in browser preview", async () => {
    isTauriMock.mockReturnValue(false);
    const { registry, gateway } = setup();
    registerWorkspaceTools(registry);
    const result = await gateway.execute("workspace.read", { path: "/private/file.txt" }, {
      traceId: "trace", runId: "run", signal: new AbortController().signal
    }, "local-user");
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("searches approved directory names through the native search command", async () => {
    const { registry, gateway, permissions } = setup();
    registerWorkspaceTools(registry);
    invokeMock.mockResolvedValue([{ name: "notes.md", path: "C:\\approved\\notes.md", kind: "file", sizeBytes: 5, modifiedAtMs: null }]);
    const result = await gateway.execute("workspace.search", {
      path: "C:\\approved", query: "notes"
    }, { traceId: "trace", runId: "run", signal: new AbortController().signal }, "local-user");
    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("search_workspace_entries", { path: "C:\\approved", query: "notes" });
    expect(permissions.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "C:\\approved" }));
  });

  it("searches file contents through the bounded native command", async () => {
    const { registry, gateway, permissions } = setup();
    registerWorkspaceTools(registry);
    invokeMock.mockResolvedValue({
      matches: [{ path: "C:\\approved\\notes.txt", lineNumber: 3, preview: "NEXUS is ready" }],
      totalMatches: 1, scannedFiles: 2, truncated: false
    });
    const result = await gateway.execute("workspace.search_content", {
      path: "C:\\approved", query: "nexus"
    }, { traceId: "trace", runId: "run", signal: new AbortController().signal }, "local-user");
    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("search_workspace_contents", { path: "C:\\approved", query: "nexus" });
    expect(permissions.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "C:\\approved" }));
  });

  it("reads only through the native command and bounds output to the tool gateway limit", async () => {
    const { registry, gateway } = setup();
    registerWorkspaceTools(registry);
    invokeMock.mockResolvedValue("\\n".repeat(60_000));
    const result = await gateway.execute<{ path: string; content: string; truncated: boolean; totalCharacters: number }>("workspace.read", { path: "C:\\approved\\notes.txt" }, {
      traceId: "trace", runId: "run", signal: new AbortController().signal
    }, "local-user");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ truncated: true, totalCharacters: 120_000 });
    if (result.ok) {
      expect(new TextEncoder().encode(JSON.stringify(result.value)).byteLength).toBeLessThanOrEqual(64_000);
      expect(result.value.content.length).toBeLessThan(48_000);
    }
    expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", { path: "C:\\approved\\notes.txt" });
  });

  it("never truncates a Unicode surrogate pair or exceeds serialized output bounds", async () => {
    const { registry, gateway } = setup();
    registerWorkspaceTools(registry);
    invokeMock.mockResolvedValue("😀".repeat(30_000));
    const result = await gateway.execute<{ path: string; content: string; truncated: boolean; totalCharacters: number }>("workspace.read", { path: "C:\\approved\\unicode.txt" }, {
      traceId: "trace", runId: "run", signal: new AbortController().signal
    }, "local-user");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new TextEncoder().encode(JSON.stringify(result.value)).byteLength).toBeLessThanOrEqual(64_000);
      const last = result.value.content.charCodeAt(result.value.content.length - 1);
      expect(last >= 0xD800 && last <= 0xDBFF).toBe(false);
    }
  });

  it("rejects oversized writes before native execution", async () => {
    const { registry, gateway } = setup();
    registerWorkspaceTools(registry);
    const result = await gateway.execute("workspace.write", { path: "C:\\approved\\file.txt", content: "x".repeat(49_000) }, {
      traceId: "trace", runId: "run", signal: new AbortController().signal
    }, "local-user");
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes rename and move through native commands under high-risk write approval", async () => {
    const { registry, gateway, permissions } = setup();
    registerWorkspaceTools(registry);
    const context = { traceId: "trace", runId: "run", signal: new AbortController().signal };
    invokeMock.mockResolvedValueOnce("C:\\approved\\final.txt").mockResolvedValueOnce("C:\\approved\\Archive\\final.txt");
    const rename = await gateway.execute("workspace.rename", { path: "C:\\approved\\draft.txt", newName: "final.txt" }, context, "local-user");
    const move = await gateway.execute("workspace.move", { path: "C:\\approved\\final.txt", destinationDirectory: "C:\\approved\\Archive" }, context, "local-user");
    expect(rename.ok).toBe(true);
    expect(move.ok).toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "rename_workspace_entry", { path: "C:\\approved\\draft.txt", newName: "final.txt" });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "move_workspace_entry", { path: "C:\\approved\\final.txt", destinationDirectory: "C:\\approved\\Archive" });
    expect(permissions.authorize).toHaveBeenCalledWith(expect.objectContaining({ scope: "filesystem:write:selected", risk: "high" }));
    expect(permissions.authorize).toHaveBeenCalledWith(expect.objectContaining({ resource: "C:\\approved\\draft.txt -> final.txt" }));
  });

  it("rejects invalid rename names and oversized move permission resources", async () => {
    const { registry, gateway } = setup();
    registerWorkspaceTools(registry);
    const context = { traceId: "trace", runId: "run", signal: new AbortController().signal };
    const badRename = await gateway.execute("workspace.rename", { path: "C:\\approved\\draft.txt", newName: "../outside" }, context, "local-user");
    const badMove = await gateway.execute("workspace.move", { path: "a".repeat(3000), destinationDirectory: "b".repeat(1100) }, context, "local-user");
    expect(badRename).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(badMove).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("routes writes and directory creation through native permission-checked commands", async () => {
    const { registry, gateway } = setup();
    registerWorkspaceTools(registry);
    const context = { traceId: "trace", runId: "run", signal: new AbortController().signal };
    const write = await gateway.execute("workspace.write", { path: "C:\\approved\\file.txt", content: "hello" }, context, "local-user");
    const mkdir = await gateway.execute("workspace.mkdir", { path: "C:\\approved\\new-folder" }, context, "local-user");
    expect(write.ok).toBe(true);
    expect(mkdir.ok).toBe(true);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "write_workspace_file", { path: "C:\\approved\\file.txt", content: "hello" });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "create_workspace_directory", { path: "C:\\approved\\new-folder" });
  });
});
