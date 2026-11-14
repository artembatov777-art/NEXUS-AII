export type WorkspacePanel =
  | "chat"
  | "command"
  | "settings"
  | "memory"
  | "search"
  | "agents"
  | "projects"
  | "knowledge"
  | "training"
  | "files"
  | "tools";

export interface WorkspacePanelState {
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  memoryOpen: boolean;
  globalSearchOpen: boolean;
  agentsOpen: boolean;
  projectsOpen: boolean;
  knowledgeOpen: boolean;
  trainingLabOpen: boolean;
  fileSystemOpen: boolean;
  toolsOpen: boolean;
}

const closed: WorkspacePanelState = {
  commandPaletteOpen: false,
  settingsOpen: false,
  memoryOpen: false,
  globalSearchOpen: false,
  agentsOpen: false,
  projectsOpen: false,
  knowledgeOpen: false,
  trainingLabOpen: false,
  fileSystemOpen: false,
  toolsOpen: false
};

/** Resolve the single active workspace surface so modal layers cannot stack. */
export function getWorkspacePanelState(panel: WorkspacePanel): WorkspacePanelState {
  switch (panel) {
    case "command": return { ...closed, commandPaletteOpen: true };
    case "settings": return { ...closed, settingsOpen: true };
    case "memory": return { ...closed, memoryOpen: true };
    case "search": return { ...closed, globalSearchOpen: true };
    case "agents": return { ...closed, agentsOpen: true };
    case "projects": return { ...closed, projectsOpen: true };
    case "knowledge": return { ...closed, knowledgeOpen: true };
    case "training": return { ...closed, trainingLabOpen: true };
    case "files": return { ...closed, fileSystemOpen: true };
    case "tools": return { ...closed, toolsOpen: true };
    case "chat": return { ...closed };
  }
}
