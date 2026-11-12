// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCenter } from "./CommandCenter";

let container: HTMLDivElement;
let root: Root;
const actions = {
  onOpenAgents: vi.fn(), onOpenMemory: vi.fn(), onOpenKnowledge: vi.fn(),
  onOpenProjects: vi.fn(), onOpenFiles: vi.fn(), onOpenTools: vi.fn(), onOpenTrainingLab: vi.fn(),
  onOpenSettings: vi.fn(), onStartPlanning: vi.fn()
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function click(label: string) {
  const button = Array.from(container.querySelectorAll("button"))
    .find(item => item.textContent?.includes(label));
  if (!button) throw new Error(`Could not find command button: ${label}`);
  act(() => button.click());
}

describe("NEXUS Command Center", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<CommandCenter
      projectCount={3} conversationCount={12} model="auto" route="remote"
      providerReady={false} providerConnection="unchecked" credentialVault="missing" workspaceReady={true} busy={false} recentActivity={[]} {...actions}
    />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows live workspace values without inventing provider readiness", () => {
    expect(container.textContent).toContain("STANDBY");
    expect(container.textContent).toContain("REMOTE");
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("NOT VERIFIED");
    expect(container.textContent).toContain("SYSTEM MONITOR");
    expect(container.textContent).toContain("Workspace storage");
    expect(container.textContent).toContain("Model generation");
    expect(container.textContent).toContain("NEXUS AI CORE");
    expect(container.textContent).toContain("Awaiting a verified model connection");
  });

  it("does not present browser preview credential storage as available", () => {
    act(() => root.render(<CommandCenter
      projectCount={0} conversationCount={0} model="auto" route="remote"
      providerReady={false} providerConnection="unchecked" credentialVault="browser"
      workspaceReady={true} busy={false} recentActivity={[]} {...actions}
    />));
    expect(container.querySelector('[aria-label="System monitor"] article:nth-child(3)')?.getAttribute("data-health")).toBe("pending");
    expect(container.textContent).toContain("Native vault unavailable in browser preview");
  });

  it("renders saved conversation history in the workspace timeline", () => {
    act(() => root.render(<CommandCenter
      projectCount={1} conversationCount={1} model="auto" route="remote"
      providerReady={true} providerConnection="reachable" credentialVault="available"
      workspaceReady={true} busy={false}
      recentActivity={[{ id: "recent-1", title: "NEXUS interface review", updatedAt: Date.now(), messageCount: 8 }]}
      {...actions}
    />));
    expect(container.textContent).toContain("WORKSPACE TIMELINE");
    expect(container.textContent).toContain("NEXUS interface review");
    expect(container.textContent).toContain("8 messages");
    expect(container.textContent).toContain("updated just now");
  });

  it("routes quick-launch and briefing actions to their real workspace handlers", () => {
    click("Agents");
    click("Memory");
    click("Knowledge");
    click("Projects");
    click("File system");
    click("Tools & MCP");
    click("Training Lab");
    click("Model settings");
    click("Draft a plan");
    expect(actions.onOpenAgents).toHaveBeenCalledOnce();
    expect(actions.onOpenMemory).toHaveBeenCalledOnce();
    expect(actions.onOpenKnowledge).toHaveBeenCalledOnce();
    expect(actions.onOpenProjects).toHaveBeenCalledOnce();
    expect(actions.onOpenFiles).toHaveBeenCalledOnce();
    expect(actions.onOpenTools).toHaveBeenCalledOnce();
    expect(actions.onOpenTrainingLab).toHaveBeenCalledOnce();
    expect(actions.onOpenSettings).toHaveBeenCalledOnce();
    expect(actions.onStartPlanning).toHaveBeenCalledOnce();
  });
});
