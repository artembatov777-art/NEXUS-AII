// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock, openMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn(), openMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, isTauri: isTauriMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

import { FileSystemPanel } from "./FileSystemPanel";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function renderPanel(onAnalyze?: (file: { name: string; path: string; content: string }) => void) {
  await act(async () => { root.render(<FileSystemPanel onClose={onClose} onAnalyze={onAnalyze} />); });
}
describe("FileSystemPanel native workspace access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    invokeMock.mockReset();
    openMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not pretend browser preview can access local folders", async () => {
    await renderPanel();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("DESKTOP REQUIRED");
    expect(container.textContent).toContain("Native desktop access required");
    expect(container.textContent).toContain("not the browser preview");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("loads approved directories and opens text files through native commands", async () => {
    const rootPath = "C:\\Users\\Owner\\Documents";
    const filePath = rootPath + "\\notes.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{
        name: "notes.txt", path: filePath, kind: "file", sizeBytes: 5, modifiedAtMs: 0
      }];
      if (command === "read_workspace_file") return "hello";
      return undefined;
    });
    await renderPanel();
    expect(container.textContent).toContain(rootPath);
    expect(container.textContent).toContain("notes.txt");
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("notes.txt"));
    expect(fileButton).toBeDefined();
    await act(async () => { fileButton!.click(); });
    expect(container.querySelector(".file-preview-pane h3")?.textContent).toBe("notes.txt");
    expect(container.querySelector(".file-preview-content pre")?.textContent).toBe("hello");
    expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", { path: filePath });
  });

  it("uses the native folder picker to populate the explicit approval path", async () => {
    isTauriMock.mockReturnValue(true);
    openMock.mockResolvedValue("C:\\Users\\Owner\\Work");
    invokeMock.mockResolvedValue([]);
    await renderPanel();
    const browse = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Browse"));
    expect(browse).toBeDefined();
    await act(async () => { browse!.click(); });
    expect(openMock).toHaveBeenCalledWith({
      directory: true, multiple: false, title: "Choose a folder NEXUS may access"
    });
    const pathInput = container.querySelector<HTMLInputElement>('input[aria-label="Folder path to grant"]');
    expect(pathInput?.value).toBe("C:\\Users\\Owner\\Work");
    expect(invokeMock).not.toHaveBeenCalledWith("grant_workspace_directory", expect.anything());
  });

  it("searches recursively by name only within the current approved directory", async () => {
    const rootPath = "C:\\Users\\Owner\\Documents";
    const matchPath = rootPath + "\\Projects\\meeting-notes.md";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [];
      if (command === "search_workspace_entries") return [{
        name: "meeting-notes.md", path: matchPath, kind: "file", sizeBytes: 12, modifiedAtMs: 0
      }];
      return undefined;
    });
    await renderPanel();
    const searchInput = container.querySelector<HTMLInputElement>('input[aria-label="Search approved folders"]');
    expect(searchInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "notes");
      searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const searchButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Search"));
    expect(searchButton).toBeDefined();
    await act(async () => { searchButton!.click(); });
    expect(invokeMock).toHaveBeenCalledWith("search_workspace_entries", { path: rootPath, query: "notes" });
    expect(container.textContent).toContain("SEARCH RESULTS");
    expect(container.textContent).toContain("meeting-notes.md");
  });


  it("searches inside approved text files and opens a matching file", async () => {
    const rootPath = "C:\\Users\\Owner\\Documents";
    const filePath = rootPath + "\\notes.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [];
      if (command === "search_workspace_contents") return {
        matches: [{ path: filePath, lineNumber: 3, preview: "The NEXUS workspace is ready" }],
        totalMatches: 1, scannedFiles: 4, truncated: false
      };
      if (command === "read_workspace_file") return "line one\\nline two\\nThe NEXUS workspace is ready";
      return undefined;
    });
    await renderPanel();
    const modeButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Text content");
    expect(modeButton).toBeDefined();
    await act(async () => { modeButton!.click(); });
    const searchInput = container.querySelector<HTMLInputElement>('input[aria-label="Search approved folders"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "nexus");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const searchButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Search"));
    await act(async () => { searchButton!.click(); });
    expect(invokeMock).toHaveBeenCalledWith("search_workspace_contents", { path: rootPath, query: "nexus" });
    expect(container.textContent).toContain("1 matches in 4 files");
    expect(container.textContent).toContain("The NEXUS workspace is ready");
    const matchButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".file-list button")).find(button => button.textContent?.includes("The NEXUS workspace is ready"));
    expect(matchButton).toBeDefined();
    await act(async () => { matchButton!.click(); });
    expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", { path: filePath });
    expect(container.querySelector(".file-preview-content pre")?.textContent).toContain("The NEXUS workspace is ready");
  });

  it("records file reads in the native tool audit history without storing the path", async () => {
    const rootPath = "/home/test/Documents";
    const filePath = rootPath + "/notes.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{ name: "notes.txt", path: filePath, kind: "file", sizeBytes: 5, modifiedAtMs: 0 }];
      if (command === "read_workspace_file") return "hello";
      return undefined;
    });
    await renderPanel();
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("notes.txt"));
    await act(async () => { fileButton!.click(); });
    expect(invokeMock).toHaveBeenCalledWith("record_tool_audit_event", {
      event: expect.objectContaining({ toolId: "filesystem.read", runId: "filesystem-owner-ui", status: "completed" })
    });
    const auditCall = invokeMock.mock.calls.find(call => call[0] === "record_tool_audit_event");
    expect(JSON.stringify(auditCall)).not.toContain(filePath);
  });
  it("hands the selected text file to the AI analysis draft callback", async () => {
    const rootPath = "C:\\Users\\Owner\\Documents";
    const filePath = rootPath + "\\notes.txt";
    const onAnalyze = vi.fn();
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{ name: "notes.txt", path: filePath, kind: "file", sizeBytes: 5, modifiedAtMs: 0 }];
      if (command === "read_workspace_file") return "hello from file";
      return undefined;
    });
    await renderPanel(onAnalyze);
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("notes.txt"));
    await act(async () => { fileButton!.click(); });
    const analyzeButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Analyze with AI");
    expect(analyzeButton).toBeDefined();
    await act(async () => { analyzeButton!.click(); });
    expect(onAnalyze).toHaveBeenCalledWith({ name: "notes.txt", path: filePath, content: "hello from file" });
  });

  it("renames a selected file only after explicit confirmation", async () => {
    const rootPath = "C:\\\\Users\\\\Owner\\\\Documents";
    const oldPath = rootPath + "\\\\draft.txt";
    const newPath = rootPath + "\\\\final.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{ name: "draft.txt", path: oldPath, kind: "file", sizeBytes: 5, modifiedAtMs: 0 }];
      if (command === "read_workspace_file") return "hello";
      if (command === "rename_workspace_entry") return newPath;
      return undefined;
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPanel();
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("draft.txt"));
    await act(async () => { fileButton!.click(); });
    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="New file name"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(renameInput, "final.txt");
      renameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const renameButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Rename");
    await act(async () => { renameButton!.click(); });
    expect(confirm).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("rename_workspace_entry", { path: oldPath, newName: "final.txt" });
    expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", { path: newPath });
    expect(container.querySelector(".file-preview-pane h3")?.textContent).toBe("final.txt");
    confirm.mockRestore();
  });

  it("moves a selected file only after explicit confirmation", async () => {
    const rootPath = "C:\\\\Users\\\\Owner\\\\Documents";
    const oldPath = rootPath + "\\\\draft.txt";
    const destination = rootPath + "\\\\Archive";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{ name: "draft.txt", path: oldPath, kind: "file", sizeBytes: 5, modifiedAtMs: 0 }];
      if (command === "read_workspace_file") return "hello";
      if (command === "move_workspace_entry") return destination + "\\\\draft.txt";
      return undefined;
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPanel();
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("draft.txt"));
    await act(async () => { fileButton!.click(); });
    const destinationInput = container.querySelector<HTMLInputElement>('input[aria-label="Move destination folder"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(destinationInput, destination);
      destinationInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const moveButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Move file");
    await act(async () => { moveButton!.click(); });
    expect(confirm).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("move_workspace_entry", { path: oldPath, destinationDirectory: destination });
    confirm.mockRestore();
  });

  it("closes from the header and backdrop", async () => {
    await renderPanel();
    const headerClose = container.querySelector<HTMLButtonElement>('button[aria-label="Close file system"]');
    expect(headerClose).not.toBeNull();
    act(() => headerClose!.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector<HTMLDivElement>(".file-workspace-backdrop");
    expect(backdrop).not.toBeNull();
    act(() => backdrop!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
