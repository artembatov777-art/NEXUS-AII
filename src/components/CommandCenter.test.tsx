// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCenter } from "./CommandCenter";

let container: HTMLDivElement;
let root: Root;
const actions = {
  onOpenAgents: vi.fn(), onOpenMemory: vi.fn(), onOpenKnowledge: vi.fn(),
  onOpenProjects: vi.fn(), onOpenFiles: vi.fn(), onOpenTools: vi.fn(),
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
  });

  it("routes quick-launch and briefing actions to their real workspace handlers", () => {
    click("Agents");
    click("Memory");
    click("Knowledge");
    click("Projects");
    click("File system");
    click("Tools & MCP");
    click("Model settings");
    click("Draft a plan");
    expect(actions.onOpenAgents).toHaveBeenCalledOnce();
    expect(actions.onOpenMemory).toHaveBeenCalledOnce();
    expect(actions.onOpenKnowledge).toHaveBeenCalledOnce();
    expect(actions.onOpenProjects).toHaveBeenCalledOnce();
    expect(actions.onOpenFiles).toHaveBeenCalledOnce();
    expect(actions.onOpenTools).toHaveBeenCalledOnce();
    expect(actions.onOpenSettings).toHaveBeenCalledOnce();
    expect(actions.onStartPlanning).toHaveBeenCalledOnce();
  });
});
