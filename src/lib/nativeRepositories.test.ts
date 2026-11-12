import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false
}));

import { WorkspaceMemoryRepository } from "./nativeRepositories";
import { LocalStorageMemoryRepository, type StorageLike } from "./memoryStorage";
import type { MemoryRecord } from "../core/memory";

class FakeStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function memory(id: string, content: string, projectId?: string): MemoryRecord {
  return {
    id: id as MemoryRecord["id"],
    content,
    category: "fact",
    scope: projectId ? "project" : "profile",
    ...(projectId ? { projectId } : {}),
    source: { type: "user_confirmed", label: "Manual" },
    tags: ["test"],
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 1
  };
}

describe("WorkspaceMemoryRepository browser fallback", () => {
  it("searches and exports the complete memory set instead of truncating at 200", async () => {
    const storage = new FakeStorage();
    const seed = new LocalStorageMemoryRepository(storage);
    for (let index = 0; index < 250; index += 1) {
      const result = await seed.save(memory(`memory-${index}`, `Archive entry ${index}`));
      expect(result.ok).toBe(true);
    }

    const repository = new WorkspaceMemoryRepository(storage);
    const found = await repository.search("249", "all", 10);
    const exported = await repository.exportAll();

    expect(found.ok && found.value.map(record => record.id)).toEqual(["memory-249"]);
    expect(exported.ok && exported.value).toHaveLength(250);
  });

  it("keeps project memory search isolated and refuses an unscoped project listing", async () => {
    const storage = new FakeStorage();
    const seed = new LocalStorageMemoryRepository(storage);
    await seed.save(memory("project-one", "Private architecture note", "p1"));
    await seed.save(memory("project-two", "Private architecture note", "p2"));

    const repository = new WorkspaceMemoryRepository(storage);
    const scoped = await repository.search("private architecture", "project", 10, "p1");
    const unscoped = await repository.list("project", 10);

    expect(scoped.ok && scoped.value.map(record => record.id)).toEqual(["project-one"]);
    expect(unscoped.ok && unscoped.value).toEqual([]);
  });
});
