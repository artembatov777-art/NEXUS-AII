// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemPanel } from "./FileSystemPanel";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function renderPanel() {
  act(() => root.render(<FileSystemPanel onClose={onClose} />));
}
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("FileSystemPanel interface contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    renderPanel();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders an explicitly disconnected, read-only preview", () => {
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain("DESIGN PREVIEW");
    expect(container.textContent).toContain("Access is not connected");
    expect(container.textContent).toContain("Read/write operations are not enabled");
    expect(container.textContent).toContain("README.md");
  });

  it("filters files and presents a useful empty state", () => {
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search files"]');
    expect(search).not.toBeNull();
    setInputValue(search!, "does-not-exist");
    expect(container.textContent).toContain("No matching files in this location.");
    expect(container.textContent).toContain("0 items");
  });

  it("changes folders and updates the inspector selection", () => {
    const sourceFolder = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.trim() === "src");
    expect(sourceFolder).toBeDefined();
    act(() => sourceFolder!.click());
    expect(container.textContent).toContain("App.tsx");
    expect(container.textContent).toContain("styles.css");
    expect(container.textContent).not.toContain("README.md");

    const styles = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("styles.css"));
    expect(styles).toBeDefined();
    act(() => styles!.click());
    expect(container.querySelector(".file-preview-pane h3")?.textContent).toBe("styles.css");
  });

  it("keeps preview-only actions honest and dismissible", () => {
    const refresh = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Refresh"));
    expect(refresh).toBeDefined();
    act(() => refresh!.click());
    expect(container.textContent).toContain("Windows folder connection is part of the native integration phase.");

    const dismiss = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notice"]');
    expect(dismiss).not.toBeNull();
    act(() => dismiss!.click());
    expect(container.textContent).not.toContain("Windows folder connection is part of the native integration phase.");
  });

  it("closes from the header, footer, and backdrop", () => {
    const headerClose = container.querySelector<HTMLButtonElement>('button[aria-label="Close file system"]');
    expect(headerClose).not.toBeNull();
    act(() => headerClose!.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    const footerClose = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Close workspace"));
    expect(footerClose).toBeDefined();
    act(() => footerClose!.click());
    expect(onClose).toHaveBeenCalledTimes(2);

    const backdrop = container.querySelector<HTMLDivElement>(".file-workspace-backdrop");
    expect(backdrop).not.toBeNull();
    act(() => backdrop!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
