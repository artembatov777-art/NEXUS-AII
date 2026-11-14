// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { LocalStorageProjectRepository, WorkspaceProjectRepository } from "./projectStorage";
import type { WorkspaceProject } from "../core/projects";

const project: WorkspaceProject = {
  id: "legacy-project" as WorkspaceProject["id"],
  name: "Legacy project",
  description: "Imported from the browser workspace",
  createdAt: 1,
  updatedAt: 1,
  archived: false,
  schemaVersion: 1
};

describe("WorkspaceProjectRepository migration", () => {
  const originalTauriInternals = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
  let nativeProjects: WorkspaceProject[];

  beforeEach(() => {
    localStorage.clear();
    nativeProjects = [];
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_projects") return [...nativeProjects];
      if (command === "save_project") {
        const item = args?.project as WorkspaceProject;
        nativeProjects = [...nativeProjects.filter(existing => existing.id !== item.id), item];
        return undefined;
      }
      if (command === "delete_project") {
        nativeProjects = nativeProjects.filter(item => item.id !== args?.id);
        return undefined;
      }
      throw new Error("Unexpected native command: " + command);
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  });

  afterEach(() => {
    if (originalTauriInternals) Object.defineProperty(window, "__TAURI_INTERNALS__", originalTauriInternals);
    else delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("waits for shared legacy migration before deleting from another panel", async () => {
    class IsolatedStorage {
      private values = new Map<string, string>();
      getItem(key: string) { return this.values.get(key) ?? null; }
      setItem(key: string, value: string) { this.values.set(key, value); }
    }
    const storage = new IsolatedStorage();
    const legacy = new LocalStorageProjectRepository(storage);
    expect((await legacy.save(project)).ok).toBe(true);

    let releaseLoad!: (projects: WorkspaceProject[]) => void;
    const firstLoad = new Promise<WorkspaceProject[]>(resolve => { releaseLoad = resolve; });
    let nativeProjects: WorkspaceProject[] = [];
    let loadCount = 0;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_projects") {
        loadCount += 1;
        return loadCount === 1 ? firstLoad : [...nativeProjects];
      }
      if (command === "save_project") {
        const item = args?.project as WorkspaceProject;
        nativeProjects = [...nativeProjects.filter(existing => existing.id !== item.id), item];
        return undefined;
      }
      if (command === "delete_project") {
        nativeProjects = nativeProjects.filter(item => item.id !== args?.id);
        return undefined;
      }
      throw new Error("Unexpected native command: " + command);
    });

    const firstPanel = new WorkspaceProjectRepository(storage);
    const secondPanel = new WorkspaceProjectRepository(storage);
    const initialList = firstPanel.list(true);
    await Promise.resolve();
    let deletionFinished = false;
    const deletion = secondPanel.delete(project.id).then(result => {
      deletionFinished = true;
      return result;
    });
    await Promise.resolve();
    expect(deletionFinished).toBe(false);

    releaseLoad([]);
    await initialList;
    expect((await deletion).ok).toBe(true);
    const afterDelete = await firstPanel.list(true);
    expect(afterDelete).toMatchObject({ ok: true, value: [] });
    expect(nativeProjects).toEqual([]);
  });

  it("does not recreate a native project deleted after legacy migration", async () => {
    const legacy = new LocalStorageProjectRepository(window.localStorage);
    expect((await legacy.save(project)).ok).toBe(true);

    const firstInstance = new WorkspaceProjectRepository(window.localStorage);
    const migrated = await firstInstance.list(true);
    expect(migrated.ok && migrated.value.map(item => item.id)).toEqual([project.id]);
    expect(nativeProjects).toEqual([project]);

    expect((await firstInstance.delete(project.id)).ok).toBe(true);
    const reopened = new WorkspaceProjectRepository(window.localStorage);
    const afterDelete = await reopened.list(true);
    expect(afterDelete.ok && afterDelete.value).toEqual([]);
    expect(nativeProjects).toEqual([]);
  });
});
