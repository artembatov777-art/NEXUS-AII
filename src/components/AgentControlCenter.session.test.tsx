// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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


  it("shows ambiguous tool evidence from an interrupted checkpoint without allowing an acknowledgement", async () => {
    localStorage.clear();
    const conversationId = "session-one";
    const threadId = `nexus-session:${conversationId.length}:${conversationId}`;
    const runId = "run-interrupted";
    localStorage.setItem("nexus-au:agent-checkpoints:v1", JSON.stringify([{
      schemaVersion: 1, runId, agentId: "nexus.local-workflow", threadId, sequence: 2,
      status: "running", state: { payload: { task: "Recover evidence" }, permissionIndex: 0, agentVersion: "1.1.0", steps: 0 },
      createdAt: 1_000, updatedAt: 2_000
    }]));
    localStorage.setItem("nexus-au:tool-audit:v1", JSON.stringify([{
      toolId: "workspace.write", runId, traceId: "run-interrupted:1",
      status: "started", timestamp: 1_200
    }]));
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(<AgentControlCenter conversationId={conversationId} conversationIds={[conversationId]}
        onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false} />);
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    await act(async () => { findButton(element, "Audit")!.click(); });
    expect(element.textContent).toContain("Ambiguous tool outcomes");
    expect(element.textContent).toContain("workspace.write");
    const inspectionButton = findButton(element, "Inspection only: run not stopped");
    expect(inspectionButton?.disabled).toBe(true);
    const persisted = JSON.parse(localStorage.getItem("nexus-au:tool-audit:v1")!);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe("started");
    await act(async () => root.unmount());
    element.remove();
    localStorage.clear();
  });

  it("offers a user-driven continuation for an interrupted local preview without tool receipts", async () => {
    localStorage.clear();
    const conversationId = "preview-restore";
    const threadId = `nexus-session:${conversationId.length}:${conversationId}`;
    localStorage.setItem("nexus-au:agent-checkpoints:v1", JSON.stringify([{
      schemaVersion: 1, runId: "preview-interrupted", agentId: "nexus.local-workflow",
      threadId, sequence: 1, status: "running",
      state: { payload: { task: "Document a safe plan" }, permissionIndex: 1, steps: 0, agentVersion: "1.1.0" },
      createdAt: 1_000, updatedAt: 1_000
    }]));
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(<AgentControlCenter conversationId={conversationId} conversationIds={[conversationId]}
        onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false} />);
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    await act(async () => { findButton(element, "Run history")!.click(); });
    expect(element.textContent).toContain("Interrupted");
    expect(findButton(element, "Continue local preview")?.disabled).toBe(false);
    const confirmation = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      await act(async () => {
        findButton(element, "Continue local preview")!.click();
        await new Promise(resolve => setTimeout(resolve, 30));
      });
      const saved = JSON.parse(localStorage.getItem("nexus-au:agent-checkpoints:v1")!);
      expect(saved[0]).toMatchObject({
        runId: "preview-interrupted", status: "waiting_for_approval",
        state: { steps: 0, permissionIndex: 0 },
        pendingApproval: { permission: "tool:execute" }
      });
      expect(localStorage.getItem("nexus-au:tool-audit:v1")).toBeNull();
    } finally {
      confirmation.mockRestore();
    }
    await act(async () => root.unmount());
    element.remove();
    localStorage.clear();
  });

  it("never offers local preview continuation when its tool outcome is ambiguous", async () => {
    localStorage.clear();
    const conversationId = "preview-ambiguous";
    const threadId = `nexus-session:${conversationId.length}:${conversationId}`;
    const runId = "preview-with-unknown-tool";
    localStorage.setItem("nexus-au:agent-checkpoints:v1", JSON.stringify([{
      schemaVersion: 1, runId, agentId: "nexus.local-workflow", threadId,
      sequence: 1, status: "running",
      state: { payload: { task: "Do not replay" }, permissionIndex: 1, steps: 0, agentVersion: "1.1.0" },
      createdAt: 1_000, updatedAt: 1_000
    }]));
    localStorage.setItem("nexus-au:tool-audit:v1", JSON.stringify([{
      toolId: "workspace.preview", runId, traceId: `${runId}:1`, status: "started", timestamp: 1_100
    }]));
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(<AgentControlCenter conversationId={conversationId} conversationIds={[conversationId]}
        onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false} />);
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    await act(async () => { findButton(element, "Run history")!.click(); });
    expect(findButton(element, "Continue local preview")).toBeUndefined();
    await act(async () => root.unmount());
    element.remove();
    localStorage.clear();
  });
});


it("shows durable parent-plan progress read-only in Desktop run history without replay controls", async () => {
  localStorage.clear();
  const conversationId = "parent-plan-inspection";
  const threadId = "nexus-session:" + conversationId.length + ":" + conversationId + "-planned";
  const checkpoint = {
    schemaVersion: 1, runId: "coord_parent-1", agentId: "nexus.desktop.workflow",
    threadId, sequence: 4, status: "failed",
    state: {
      kind: "nexus.plan-run.v1",
      steps: [
        { id: "read", toolId: "workspace.read" },
        { id: "write", toolId: "workspace.write" }
      ],
      nextStep: 1,
      active: { index: 1, id: "write", toolId: "workspace.write" }
    },
    createdAt: 1_000, updatedAt: 2_000
  };
  localStorage.setItem("nexus-au:agent-checkpoints:v1", JSON.stringify([checkpoint]));
  const before = localStorage.getItem("nexus-au:agent-checkpoints:v1");
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  await act(async () => {
    root.render(<AgentControlCenter conversationId={conversationId}
      conversationIds={[conversationId]} onClose={() => {}}
      providerSettings={DEFAULT_PROVIDER} hasProviderKey={false} />);
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  await act(async () => { findButton(node, "Run history")!.click(); });
  expect(node.textContent).toContain("Plan progress: 1/2 confirmed");
  expect(node.textContent).toContain("Unconfirmed dispatch");
  expect(node.textContent).toContain("workspace.write");
  expect(node.textContent).toContain("Owner inspection required");
  expect(findButton(node, "Continue local preview")).toBeUndefined();
  expect(localStorage.getItem("nexus-au:agent-checkpoints:v1")).toBe(before);
  await act(async () => root.unmount());
  node.remove();
  localStorage.clear();
});
