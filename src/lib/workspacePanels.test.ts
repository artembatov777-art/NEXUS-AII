import { describe, expect, it } from "vitest";
import { getWorkspacePanelState, type WorkspacePanel } from "./workspacePanels";

const panels: WorkspacePanel[] = [
  "chat", "command", "settings", "memory", "search",
  "agents", "projects", "knowledge", "training", "files", "tools"
];

describe("workspace panel routing", () => {
  it.each(panels)("opens only the requested %s surface", panel => {
    const state = getWorkspacePanelState(panel);
    const active = Object.entries(state).filter(([, isOpen]) => isOpen);
    const expectedKey = ({
      command: "commandPaletteOpen",
      settings: "settingsOpen",
      memory: "memoryOpen",
      search: "globalSearchOpen",
      agents: "agentsOpen",
      projects: "projectsOpen",
      knowledge: "knowledgeOpen",
      training: "trainingLabOpen",
      files: "fileSystemOpen",
      tools: "toolsOpen"
    } as const)[panel as Exclude<WorkspacePanel, "chat">];

    if (panel === "chat") {
      expect(active).toHaveLength(0);
      return;
    }
    expect(active).toEqual([[expectedKey, true]]);
  });

  it("never leaves a second workspace surface open after switching", () => {
    for (const panel of panels) {
      const state = getWorkspacePanelState(panel);
      expect(Object.values(state).filter(Boolean)).toHaveLength(panel === "chat" ? 0 : 1);
    }
  });
});
