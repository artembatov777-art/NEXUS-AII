// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AgentControlCenter } from "./AgentControlCenter";
import { DEFAULT_PROVIDER } from "../types";
import { LocalStorageAgentActivityRepository } from "../lib/agentActivityStorage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const button = (node: HTMLElement, label: string) =>
  [...node.querySelectorAll("button")].find(item => item.textContent?.includes(label));

describe("persisted agent activity UI", () => {
  it("reloads saved activity from a previous app session without replaying its task", async () => {
    localStorage.clear();
    const repo = new LocalStorageAgentActivityRepository(localStorage);
    expect((await repo.append({ runId: "saved-run", conversationId: "saved-chat",
      kind: "started", timestamp: 100 })).ok).toBe(true);
    expect((await repo.append({ runId: "saved-run", conversationId: "saved-chat",
      kind: "progress", step: 2, maxSteps: 3, timestamp: 200 })).ok).toBe(true);
    expect((await repo.append({ runId: "elsewhere", conversationId: "other-chat",
      kind: "failed", timestamp: 300 })).ok).toBe(true);
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    await act(async () => {
      root.render(<AgentControlCenter conversationId="saved-chat"
        onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false} />);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { button(node, "Run event stream")!.click(); });
    const saved = node.querySelector('[aria-label="Saved agent activity"]');
    expect(saved?.textContent).toContain("Step 2 of 3");
    expect(saved?.textContent).toContain("Agent started");
    expect(saved?.textContent).not.toContain("elsewhere");
    await act(async () => root.unmount());
    node.remove();
  });

  it("records approval transitions and displays them after the panel remounts", async () => {
    localStorage.clear();
    const node = document.createElement("div"); document.body.append(node);
    let root = createRoot(node);
    const render = () => <AgentControlCenter conversationId="approval-history"
      initialTask="Inspect notes" onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false}/>;
    await act(async () => { root.render(render()); });
    await act(async () => { button(node, "Run demo")!.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
    const reader = new LocalStorageAgentActivityRepository(localStorage);
    const history = await reader.listByConversation("approval-history", 20);
    expect(history.ok && history.value.some(event => event.kind === "approval")).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(node);
    await act(async () => { root.render(render()); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    await act(async () => { button(node, "Run event stream")!.click(); });
    expect(node.querySelector('[aria-label="Saved agent activity"]')?.textContent)
      .toContain("Approval required");
    await act(async () => root.unmount());
    node.remove();
  });
});
