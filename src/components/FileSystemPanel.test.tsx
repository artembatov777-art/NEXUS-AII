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

  it("moves selected files as a batch and records each move", async () => {
    const rootPath = "/home/test/Documents";
    const destination = rootPath + "/Archive";
    const paths = [rootPath + "/one.txt", rootPath + "/two.txt"];
    const moved = new Set<string>();
    isTauriMock.mockReturnValue(true);
    openMock.mockResolvedValue(destination);
    invokeMock.mockImplementation(async (command: string, args?: { path?: string; destinationDirectory?: string }) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [
        { name: "one.txt", path: paths[0], kind: "file", sizeBytes: 10, modifiedAtMs: 0 },
        { name: "two.txt", path: paths[1], kind: "file", sizeBytes: 10, modifiedAtMs: 0 }
      ].filter(entry => !moved.has(entry.path));
      if (command === "move_workspace_entry") {
        const source = args?.path ?? "";
        const target = (args?.destinationDirectory ?? "") + "/" + source.split("/").pop();
        moved.add(source);
        return target;
      }
      return undefined;
    });
    await renderPanel();
    vi.stubGlobal("confirm", vi.fn(() => true));
    for (const name of ["one.txt", "two.txt"]) {
      const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Select ' + name + ' for bulk move"]')!;
      await act(async () => { checkbox.click(); });
    }
    const moveButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Move selected"));
    await act(async () => { moveButton!.click(); });
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false, title: "Choose destination folder" });
    expect(invokeMock.mock.calls.filter(([command]) => command === "move_workspace_entry")).toHaveLength(2);
    expect(container.textContent).toContain("Moved 2 files.");
    expect(container.querySelector('input[aria-label="Select one.txt for bulk move"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it("rolls back earlier batch moves when a later file conflicts", async () => {
    const rootPath = "/home/test/Documents";
    const destination = rootPath + "/Archive";
    const firstPath = rootPath + "/one.txt";
    const secondPath = rootPath + "/two.txt";
    let moveCalls = 0;
    isTauriMock.mockReturnValue(true);
    openMock.mockResolvedValue(destination);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [
        { name: "one.txt", path: firstPath, kind: "file", sizeBytes: 10, modifiedAtMs: 0 },
        { name: "two.txt", path: secondPath, kind: "file", sizeBytes: 10, modifiedAtMs: 0 }
      ];
      if (command === "move_workspace_entry") {
        moveCalls += 1;
        if (moveCalls === 2) throw new Error("Destination already exists");
        if (moveCalls === 1) return destination + "/one.txt";
        return firstPath;
      }
      return undefined;
    });
    await renderPanel();
    vi.stubGlobal("confirm", vi.fn(() => true));
    for (const name of ["one.txt", "two.txt"]) {
      const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Select ' + name + ' for bulk move"]')!;
      await act(async () => { checkbox.click(); });
    }
    const moveButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Move selected"));
    await act(async () => { moveButton!.click(); });
    expect(moveCalls).toBe(3);
    expect(container.textContent).toContain("Bulk move failed; previously moved files were restored.");
    expect(container.textContent).not.toContain("rollback was incomplete");
    vi.unstubAllGlobals();
  });

  it("clears bulk file selections before switching to search results", async () => {
    const rootPath = "/home/test/Documents";
    const filePath = rootPath + "/one.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [
        { name: "one.txt", path: filePath, kind: "file", sizeBytes: 10, modifiedAtMs: 0 }
      ];
      if (command === "search_workspace_contents") return {
        matches: [{ path: filePath, lineNumber: 1, preview: "needle" }],
        totalMatches: 1, scannedFiles: 1, truncated: false
      };
      return undefined;
    });
    await renderPanel();
    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Select one.txt for bulk move"]')!;
    await act(async () => { checkbox.click(); });
    expect(container.textContent).toContain("1 of 100 files selected");

    const contentMode = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Text content");
    await act(async () => { contentMode!.click(); });
    const searchInput = container.querySelector<HTMLInputElement>('input[aria-label="Search approved folders"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "needle");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const searchButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Search"));
    await act(async () => { searchButton!.click(); });

    expect(invokeMock).toHaveBeenCalledWith("search_workspace_contents", { path: rootPath, query: "needle" });
    expect(container.textContent).not.toContain("1 of 100 files selected");
    expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent?.includes("Move selected"))).toBe(false);
  });

  it("preserves an unsaved draft when the owner cancels a file search", async () => {
    const rootPath = "/home/test/Documents";
    const filePath = rootPath + "/notes.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [
        { name: "notes.txt", path: filePath, kind: "file", sizeBytes: 8, modifiedAtMs: 0 }
      ];
      if (command === "read_workspace_file") return "original";
      return undefined;
    });
    await renderPanel();
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("notes.txt"));
    await act(async () => { fileButton!.click(); });
    const editButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Edit file"));
    await act(async () => { editButton!.click(); });
    const editor = container.querySelector<HTMLTextAreaElement>("textarea.file-editor")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(editor, "unsaved draft");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const searchInput = container.querySelector<HTMLInputElement>('input[aria-label="Search approved folders"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "needle");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const searchButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Search"));
    await act(async () => { searchButton!.click(); });

    expect(confirm).toHaveBeenCalledWith("You have unsaved file edits. Discard them and search files?");
    expect(container.querySelector<HTMLTextAreaElement>("textarea.file-editor")?.value).toBe("unsaved draft");
    expect(invokeMock).not.toHaveBeenCalledWith("search_workspace_entries", expect.anything());
    confirm.mockRestore();
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

  it("previews approved raster images without treating binary data as editable text", async () => {
    const rootPath = "/home/test/Pictures";
    const filePath = rootPath + "/diagram.png";
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{ name: "diagram.png", path: filePath, kind: "file", sizeBytes: 8, modifiedAtMs: 0 }];
      if (command === "read_workspace_image_preview") return { dataUrl, mediaType: "image/png", sizeBytes: 8 };
      return undefined;
    });
    await renderPanel();
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("diagram.png"));
    await act(async () => { fileButton!.click(); });
    const image = container.querySelector<HTMLImageElement>(".file-image-preview img");
    expect(image?.src).toBe(dataUrl);
    expect(container.textContent).toContain("image/png");
    expect(container.textContent).toContain("read-only");
    expect(container.querySelector("textarea.file-editor")).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some(button => button.textContent === "Edit file")).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("read_workspace_image_preview", { path: filePath });
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
      if (command === "read_workspace_file") return "line one\nline two\nThe NEXUS workspace is ready";
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

  it("preserves the edit draft and reports an external file conflict instead of overwriting", async () => {
    const rootPath = "/home/test/Documents";
    const filePath = rootPath + "/notes.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{ name: "notes.txt", path: filePath, kind: "file", sizeBytes: 8, modifiedAtMs: 0 }];
      if (command === "read_workspace_file") return "original";
      if (command === "write_workspace_file_checked") throw new Error("File changed outside NEXUS since it was opened.");
      return undefined;
    });
    await renderPanel();
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("notes.txt"));
    await act(async () => { fileButton!.click(); });
    const editButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Edit file"));
    await act(async () => { editButton!.click(); });
    const editor = container.querySelector<HTMLTextAreaElement>("textarea.file-editor")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(editor, "my draft");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Save changes"));
    await act(async () => { saveButton!.click(); });
    expect(invokeMock).toHaveBeenCalledWith("write_workspace_file_checked", {
      path: filePath, content: "my draft", expectedContent: "original"
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("File changed outside NEXUS");
    expect(container.querySelector<HTMLTextAreaElement>("textarea.file-editor")?.value).toBe("my draft");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "read_workspace_file") return "external version";
      if (command === "list_workspace_entries") return [{ name: "notes.txt", path: filePath, kind: "file", sizeBytes: 16, modifiedAtMs: 0 }];
      return undefined;
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    const reloadButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Reload latest version"));
    expect(reloadButton).toBeDefined();
    await act(async () => { reloadButton!.click(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea.file-editor")).toBeNull();
    expect(container.querySelector(".file-preview-content pre")?.textContent).toBe("external version");
    vi.unstubAllGlobals();
  });

  it("keeps an unsaved draft when another file is selected and discard is declined", async () => {
    const rootPath = "/home/test/Documents";
    const firstPath = rootPath + "/notes.txt";
    const secondPath = rootPath + "/other.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string, args?: { path?: string }) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [
        { name: "notes.txt", path: firstPath, kind: "file", sizeBytes: 8, modifiedAtMs: 0 },
        { name: "other.txt", path: secondPath, kind: "file", sizeBytes: 5, modifiedAtMs: 0 }
      ];
      if (command === "read_workspace_file") return args?.path === firstPath ? "original" : "other";
      return undefined;
    });
    await renderPanel();
    const firstButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("notes.txt"));
    await act(async () => { firstButton!.click(); });
    const editButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Edit file"));
    await act(async () => { editButton!.click(); });
    const editor = container.querySelector<HTMLTextAreaElement>("textarea.file-editor")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(editor, "unsaved draft");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.stubGlobal("confirm", vi.fn(() => false));
    const secondButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("other.txt"));
    await act(async () => { secondButton!.click(); });
    expect(container.querySelector<HTMLTextAreaElement>("textarea.file-editor")?.value).toBe("unsaved draft");
    expect(invokeMock).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });

  it("asks before closing the workspace while file edits are unsaved, including Escape requests", async () => {
    const rootPath = "/home/test/Documents";
    const filePath = rootPath + "/notes.txt";
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_workspace_directories") return [rootPath];
      if (command === "list_workspace_entries") return [{ name: "notes.txt", path: filePath, kind: "file", sizeBytes: 8, modifiedAtMs: 0 }];
      if (command === "read_workspace_file") return "original";
      return undefined;
    });
    await renderPanel();
    const fileButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("notes.txt"));
    await act(async () => { fileButton!.click(); });
    const editButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Edit file"));
    await act(async () => { editButton!.click(); });
    const editor = container.querySelector<HTMLTextAreaElement>("textarea.file-editor")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(editor, "unsaved draft");
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.stubGlobal("confirm", vi.fn(() => false));
    await act(async () => { window.dispatchEvent(new Event("nexus-file-system-close-request")); });
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLTextAreaElement>("textarea.file-editor")?.value).toBe("unsaved draft");
    vi.unstubAllGlobals();
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
