// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { AgentControlCenter } from "./AgentControlCenter";
import { DEFAULT_PROVIDER } from "../types";
import { AgentCheckpointService } from "../core/agentCheckpoints";
import { LocalStorageAgentCheckpointRepository } from "../lib/agentCheckpointStorage";
import { LocalStorageToolAuditSink } from "../lib/toolAuditStorage";
import { agentThreads } from "../lib/agentThreads";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll("button")].find(item => item.textContent?.includes(label));

describe("Agent Center persisted run history", () => {
  it("loads more than 50 saved checkpoints on demand without dropping older runs", async () => {
    localStorage.clear();
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(localStorage));
    for (let i = 0; i < 75; i++) {
      const saved = await service.persist({
        schemaVersion: 1, runId: "historic-" + i,
        agentId: "nexus.local-workflow",
        threadId: agentThreads("history-session").primary,
        sequence: 1, status: "completed", state: { payload: { task: "Saved task " + i } },
        createdAt: 1_000 + i, updatedAt: 1_000 + i
      });
      expect(saved.ok).toBe(true);
    }
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    await act(async () => {
      root.render(<AgentControlCenter conversationId="history-session"
        onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false} />);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await act(async () => { button(node, "Run history")!.click(); });
    expect(node.querySelectorAll(".agent-history-item")).toHaveLength(50);
    expect(node.textContent).toContain("Showing 50 of 75 runs");
    await act(async () => { button(node, "Load more runs")!.click(); });
    expect(node.querySelectorAll(".agent-history-item")).toHaveLength(75);
    expect(node.textContent).toContain("Showing 75 of 75 runs");
    await act(async () => root.unmount());
    node.remove();
  });

  it("opens the real tool audit scoped to the chosen saved run", async () => {
    localStorage.clear();
    const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(localStorage));
    for (const runId of ["history-one", "history-two"]) {
      expect((await service.persist({
        schemaVersion: 1, runId, agentId: "nexus.local-workflow",
        threadId: agentThreads("history-session").primary,
        sequence: 1, status: "completed", state: { payload: { task: runId } },
        createdAt: 1_000, updatedAt: 1_000
      })).ok).toBe(true);
    }
    const audit = new LocalStorageToolAuditSink(localStorage);
    expect((await audit.record({ runId: "history-one", traceId: "history-one:1",
      toolId: "workspace.read", status: "completed", timestamp: 2_000 })).ok).toBe(true);
    expect((await audit.record({ runId: "history-two", traceId: "history-two:1",
      toolId: "workspace.write", status: "completed", timestamp: 2_001 })).ok).toBe(true);
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    await act(async () => {
      root.render(<AgentControlCenter conversationId="history-session"
        onClose={() => {}} providerSettings={DEFAULT_PROVIDER} hasProviderKey={false} />);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await act(async () => { button(node, "Run history")!.click(); });
    const row = [...node.querySelectorAll(".agent-history-item")].find(item => item.textContent?.includes("history-one"));
    expect(row).toBeDefined();
    await act(async () => { button(row as HTMLElement, "Inspect audit")!.click(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(node.textContent).toContain("Audit for history-one");
    const auditPanel = [...node.querySelectorAll(".agent-card")].find(item => item.textContent?.includes("Recent tool audit"));
    expect(auditPanel?.textContent).toContain("workspace.read");
    expect(auditPanel?.textContent).not.toContain("workspace.write");
    await act(async () => root.unmount());
    node.remove();
  });
});
