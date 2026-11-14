// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceStudio } from "./WorkspaceStudio";

let container: HTMLDivElement;
let root: Root;
const actions = { onClose: vi.fn(), onToggleFocus: vi.fn(), onOpenAgents: vi.fn(), onOpenFiles: vi.fn(), onOpenKnowledge: vi.fn(), onOpenTools: vi.fn(), onOpenChat: vi.fn() };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.click());
}

describe("NEXUS Studio", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<WorkspaceStudio {...actions} conversations={[]} projects={[]} providerConfigured={false} providerVerified={false} nativeRuntime={false} workspaceReady={true} focusMode={false}/>));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); });

  it("persists inbox notes", () => {
    click("Inbox");
    const title = container.querySelector<HTMLInputElement>('input[aria-label="Inbox title"]');
    const note = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Inbox note"]');
    if (!title || !note) throw new Error("Inbox fields missing");
    const titleSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const noteSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!titleSetter || !noteSetter) throw new Error("Native input setters unavailable");
    act(() => { titleSetter.call(title, "Idea"); title.dispatchEvent(new Event("input", { bubbles: true })); noteSetter.call(note, "A useful note"); note.dispatchEvent(new Event("input", { bubbles: true })); });
    click("Save to inbox");
    expect(container.textContent).toContain("Idea");
    expect(JSON.parse(localStorage.getItem("nexus-au:studio-inbox:v1") ?? "[]")).toHaveLength(1);
  });

  it("creates persistent knowledge nodes", () => {
    click("Knowledge Graph");
    const node = container.querySelector<HTMLInputElement>('input[aria-label="New knowledge node"]');
    if (!node) throw new Error("Knowledge node input missing");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Native input setter unavailable");
    act(() => { setter.call(node, "AI architecture"); node.dispatchEvent(new Event("input", { bubbles: true })); });
    click("Add node");
    expect(container.textContent).toContain("AI architecture");
    expect(JSON.parse(localStorage.getItem("nexus-au:studio-graph:v1") ?? "[]")).toHaveLength(1);
    const source = container.querySelector<HTMLSelectElement>('select[aria-label="Relationship source"]');
    const target = container.querySelector<HTMLSelectElement>('select[aria-label="Relationship target"]');
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();
  });

  it("shows real workspace analytics and health states", () => {
    click("Workspace Analytics");
    expect(container.textContent).toContain("Saved conversations");
    click("Guardian");
    expect(container.textContent).toContain("Browser preview cannot access native file and credential services.");
  });

  it("routes connected features to their real modules", () => {
    click("Agent Command Center");
    expect(actions.onOpenAgents).toHaveBeenCalledOnce();
    click("Overview");
    click("Smart File Intelligence");
    expect(actions.onOpenFiles).toHaveBeenCalledOnce();
  });
});
