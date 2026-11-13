// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystemPanel } from "./FileSystemPanel";
import { ToolsPanel } from "./ToolsPanel";

let container: HTMLDivElement;
let root: Root;
let onClose: ReturnType<typeof vi.fn<() => void>>;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function mount(node: ReactNode) {
  act(() => root.render(node));
}

function buttonContaining(label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find(candidate => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Button containing "${label}" was not found.`);
  return button;
}

function setInputValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("Could not access the native input value setter.");
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickBackdrop(selector: string) {
  const backdrop = container.querySelector<HTMLElement>(selector);
  if (!backdrop) throw new Error(`Backdrop "${selector}" was not found.`);
  act(() => backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onClose = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("FileSystemPanel native access boundary", () => {
  beforeEach(() => mount(<FileSystemPanel onClose={onClose} />));

  it("clearly states that browser preview cannot access local folders", () => {
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("DESKTOP REQUIRED");
    expect(dialog?.textContent).toContain("Native desktop access required");
    expect(dialog?.textContent).not.toContain("README.md");
  });

  it("closes from its close control and from the backdrop", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Close file system"]')?.click());
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    clickBackdrop(".file-workspace-backdrop");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("ToolsPanel preview interactions", () => {
  beforeEach(() => mount(<ToolsPanel onClose={onClose} />));

  it("states that the catalog is a preview and no connectors are connected", () => {
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("LIVE MCP + CATALOG");
    expect(dialog?.textContent).toContain("NOT CONNECTED");
    expect(dialog?.textContent).toContain("Configure a real MCP server above");
    expect(dialog?.textContent).toContain("06");
  });

  it("filters the catalog and renders a clear no-results state", () => {
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search tools"]');
    if (!search) throw new Error("Tool search input was not found.");
    setInputValue(search, "GitHub");

    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).not.toContain("Browser");

    setInputValue(search, "not-a-real-connector");
    expect(container.textContent).toContain("No tools match this search.");
  });

  it("links each expandable card to its details and keeps the expanded state accurate", () => {
    const card = buttonContaining("Browser");
    const detailsId = card.getAttribute("aria-controls");
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(detailsId).toBeTruthy();
    expect(container.querySelector(`#${detailsId}`)?.textContent).toContain("EXECUTION MODE");

    act(() => card.click());
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(`#${detailsId}`)).toBeNull();
  });

  it("announces connection requirements and allows the notice to be dismissed", () => {
    act(() => buttonContaining("View connection requirements").click());
    const status = container.querySelector('[role="status"][aria-live="polite"]');
    expect(status?.textContent).toContain("Browser: connection controls will appear");

    act(() => status?.querySelector<HTMLButtonElement>('[aria-label="Dismiss notice"]')?.click());
    expect(container.querySelector('[role="status"][aria-live="polite"]')).toBeNull();
  });

  it("closes from its close control and from the backdrop", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Close tools"]')?.click());
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    clickBackdrop(".tools-workspace-backdrop");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
