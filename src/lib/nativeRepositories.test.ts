import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  isTauriMock: vi.fn<() => boolean>(() => false)
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock
}));

import { WorkspaceKnowledgeRepository, WorkspaceMemoryRepository, tokenizeKnowledgeTerms } from "./nativeRepositories";
import { LocalStorageMemoryRepository, type StorageLike } from "./memoryStorage";
import type { MemoryRecord } from "../core/memory";
import type { KnowledgeChunk } from "../core/knowledge";

beforeEach(() => {
  invokeMock.mockReset();
  isTauriMock.mockReturnValue(false);
});

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


  it("refreshes native snapshots across repository instances and observes external updates", async () => {
    isTauriMock.mockReturnValue(true);
    const nativeRecords = new Map<string, MemoryRecord>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_memories") return [...nativeRecords.values()];
      if (command === "save_memory") {
        const record = args?.record as MemoryRecord;
        nativeRecords.set(record.id, record);
        return undefined;
      }
      if (command === "delete_memory") {
        nativeRecords.delete(String(args?.id));
        return undefined;
      }
      throw new Error("Unexpected native command: " + command);
    });

    const storage = new FakeStorage();
    const firstPanel = new WorkspaceMemoryRepository(storage);
    const secondPanel = new WorkspaceMemoryRepository(storage);

    const initial = await firstPanel.list("all", 50);
    expect(initial.ok && initial.value).toEqual([]);

    const created = await secondPanel.save(memory("shared-native", "Created in another panel"));
    expect(created.ok).toBe(true);

    const afterCreate = await firstPanel.list("all", 50);
    expect(afterCreate.ok && afterCreate.value.map(record => record.id)).toContain("shared-native");

    const removed = await secondPanel.delete("shared-native" as MemoryRecord["id"]);
    expect(removed.ok).toBe(true);

    const afterDelete = await firstPanel.list("all", 50);
    expect(afterDelete.ok && afterDelete.value.map(record => record.id)).not.toContain("shared-native");
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


describe("WorkspaceKnowledgeRepository native freshness", () => {
  it("exposes document imports, replacements, and deletions across repository instances", async () => {
    isTauriMock.mockReturnValue(true);
    const nativeChunks = new Map<string, KnowledgeChunk>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_knowledge_chunks") return [...nativeChunks.values()];
      if (command === "save_knowledge_chunks") {
        for (const chunk of args?.chunks as KnowledgeChunk[]) nativeChunks.set(chunk.id, chunk);
        return undefined;
      }
      if (command === "replace_knowledge_document") {
        const documentId = String(args?.documentId);
        const projectId = String(args?.projectId);
        for (const [id, chunk] of nativeChunks) {
          if (chunk.documentId === documentId && chunk.projectId === projectId) nativeChunks.delete(id);
        }
        for (const chunk of args?.chunks as KnowledgeChunk[]) nativeChunks.set(chunk.id, chunk);
        return undefined;
      }
      if (command === "delete_knowledge_document") {
        const documentId = String(args?.documentId);
        const projectId = String(args?.projectId);
        for (const [id, chunk] of nativeChunks) {
          if (chunk.documentId === documentId && chunk.projectId === projectId) nativeChunks.delete(id);
        }
        return undefined;
      }
      throw new Error("Unexpected native command: " + command);
    });

    const storage = new FakeStorage();
    const chatServiceRepository = new WorkspaceKnowledgeRepository(storage);
    const knowledgePanelRepository = new WorkspaceKnowledgeRepository(storage);
    const original: KnowledgeChunk = {
      id: "chunk-v1",
      documentId: "doc-1",
      projectId: "project-1",
      text: "The architecture uses a modular monolith.",
      sourceLabel: "architecture.md"
    };

    const added = await knowledgePanelRepository.add([original]);
    expect(added.ok).toBe(true);
    const visibleToChat = await chatServiceRepository.search("modular monolith", "project-1", 10);
    expect(visibleToChat.ok && visibleToChat.value.map(chunk => chunk.id)).toEqual(["chunk-v1"]);

    const replacement: KnowledgeChunk = {
      ...original,
      id: "chunk-v2",
      text: "The updated architecture uses isolated module contracts."
    };
    const replaced = await knowledgePanelRepository.replaceDocument("doc-1", "project-1", [replacement]);
    expect(replaced.ok).toBe(true);
    const oldSearch = await chatServiceRepository.search("modular monolith", "project-1", 10);
    const newSearch = await chatServiceRepository.search("isolated module contracts", "project-1", 10);
    expect(oldSearch.ok && oldSearch.value).toEqual([]);
    expect(newSearch.ok && newSearch.value.map(chunk => chunk.id)).toEqual(["chunk-v2"]);

    const removed = await knowledgePanelRepository.removeDocument("doc-1", "project-1");
    expect(removed.ok).toBe(true);
    const afterDelete = await chatServiceRepository.search("isolated module contracts", "project-1", 10);
    expect(afterDelete.ok && afterDelete.value).toEqual([]);
  });
});

describe("native knowledge query tokenization", () => {
  it("recognizes Cyrillic and Latin terms without splitting Unicode letters", () => {
    expect(tokenizeKnowledgeTerms("Архитектура NEXUS память 2026")).toEqual(["архитектура", "nexus", "память", "2026"]);
  });
});
