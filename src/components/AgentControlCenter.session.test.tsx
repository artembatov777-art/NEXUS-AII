// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AgentControlCenter } from "./AgentControlCenter";
import { DEFAULT_PROVIDER } from "../types";
import { AgentRunManager } from "../lib/agentRunManager";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const findButton = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes(label));

describe("agent center session checkpoints", () => {
  it("starts a real local demo, restores its approval, and isolates another conversation", async () => {
    localStorage.clear();
    const element = document.createElement("div"); document.body.appendChild(element);
    const root = createRoot(element);
    const render = (id: string) => <AgentControlCenter key={id} conversationId={id} conversationIds={["session-one", "session-two"]} initialTask="Inspect a task" onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false}/>;
    await act(async () => { root.render(render("session-one")); });
    const start = findButton(element, "Run demo");
    expect(start?.disabled).toBe(false);
    await act(async () => { start!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(element.textContent).toContain("Approval required");
    await act(async () => { root.render(render("session-two")); });
    expect(element.textContent).toContain("No pending approvals.");
    await act(async () => { findButton(element, "Profile settings")!.click(); });
    await act(async () => { findButton(element, "Save profile")!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(element.textContent).toContain("Finish or reject active runs in every conversation");
    await act(async () => { root.render(render("session-one")); });
    expect(element.textContent).toContain("Approve once");
    await act(async () => { findButton(element, "Approve once")!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(element.textContent).toContain("Completed");
    await act(async () => root.unmount()); element.remove();
  });
  it("keeps approval and event history scoped to a conversation without remounting", async () => {
    localStorage.clear();
    const element = document.createElement("div"); document.body.appendChild(element);
    const root = createRoot(element);
    const manager = new AgentRunManager();
    const render = (id: string) => <AgentControlCenter agentRuns={manager} conversationId={id} conversationIds={["one", "two"]} initialTask="Inspect a task" onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false}/>;
    await act(async () => { root.render(render("one")); });
    await act(async () => { findButton(element, "Run demo")!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(manager.summary("one").waiting_for_approval).toBe(1);
    const waiting = manager.list("one")[0];
    expect(waiting.runtimeRunId).toBeTruthy();
    await act(async () => { findButton(element, "Run event stream")!.click(); });
    expect(element.querySelector(".agent-feed")?.textContent).toContain("Approval required");
    await act(async () => { root.render(render("two")); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(element.querySelector(".agent-feed")?.textContent ?? "").not.toContain("Approval required");
    expect(manager.summary("two").waiting_for_approval).toBe(0);
    await act(async () => { root.render(render("one")); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(element.querySelector(".agent-feed")?.textContent).toContain("Approval required");
    await act(async () => { findButton(element, "Approvals")!.click(); });
    await act(async () => { findButton(element, "Approve once")!.click(); await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(manager.summary("one").waiting_for_approval).toBe(0);
    expect(manager.list("one").some(run => run.status === "completed")).toBe(true);
    await act(async () => root.unmount()); element.remove();
  });

});
