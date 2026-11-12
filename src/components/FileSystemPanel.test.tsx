// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, isTauri: isTauriMock }));

import { FileSystemPanel } from "./FileSystemPanel";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function renderPanel() {
  await act(async () => { root.render(<FileSystemPanel onClose={onClose} />); });
}
describe("FileSystemPanel native workspace access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(false);
    invokeMock.mockReset();
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
