// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type NexusCommandId } from "./CommandPalette";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onRun = vi.fn<(id: NexusCommandId) => void>();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("NEXUS command palette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<CommandPalette onClose={onClose} onRun={onRun}/>));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("filters commands by title and description", () => {
    const input = container.querySelector<HTMLInputElement>('input[aria-label="Search commands"]');
    expect(input).not.toBeNull();
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Ollama"); input!.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(container.textContent).toContain("Models & providers");
    expect(container.textContent).not.toContain("Agent center");
  });

  it("dispatches a selected command and exposes close control", () => {
    const agents = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Agent center"));
    expect(agents).toBeDefined();
    act(() => agents!.click());
    expect(onRun).toHaveBeenCalledWith("agents");
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close command palette"]');
    expect(close).not.toBeNull();
  });
});
