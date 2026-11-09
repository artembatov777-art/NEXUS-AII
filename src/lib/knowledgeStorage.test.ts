import { describe, expect, it } from "vitest";
import { LocalStorageKnowledgeRepository } from "./knowledgeStorage";
import type { StorageLike } from "./memoryStorage";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("LocalStorageKnowledgeRepository", () => {
  it("lists unique documents and aggregates chunk metadata within one project", async () => {
    const repository = new LocalStorageKnowledgeRepository(new MemoryStorage());
    const saved = await repository.add([
      { id: "d1:1", documentId: "d1", projectId: "p1", text: "first passage", sourceLabel: "notes.md" },
      { id: "d1:2", documentId: "d1", projectId: "p1", text: "second passage", sourceLabel: "notes.md" },
      { id: "d2:1", documentId: "d2", projectId: "p2", text: "private project passage", sourceLabel: "other.txt" }
    ]);
    expect(saved.ok).toBe(true);
    const result = await repository.listDocuments("p1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([
      { documentId: "d1", fileName: "notes.md", chunkCount: 2, characterCount: 27 }
    ]);
  });

  it("atomically replaces a document index without leaving old chunks", async () => {
    const repository = new LocalStorageKnowledgeRepository(new MemoryStorage());
    await repository.add([
      { id: "doc:1", documentId: "doc", projectId: "p1", text: "old passage", sourceLabel: "notes.txt" },
      { id: "doc:2", documentId: "doc", projectId: "p1", text: "old second passage", sourceLabel: "notes.txt" }
    ]);
    const replaced = await repository.replaceDocument("doc", "p1", [
      { id: "doc:1", documentId: "doc", projectId: "p1", text: "updated content", sourceLabel: "notes.txt" }
    ]);
    expect(replaced.ok).toBe(true);
    const documents = await repository.listDocuments("p1");
    expect(documents.ok && documents.value).toEqual([
      { documentId: "doc", fileName: "notes.txt", chunkCount: 1, characterCount: 15 }
    ]);
    const search = await repository.search("old", "p1", 10);
    expect(search.ok && search.value).toEqual([]);
  });

  it("removes only the selected document in the selected project", async () => {
    const repository = new LocalStorageKnowledgeRepository(new MemoryStorage());
    await repository.add([
      { id: "same:1", documentId: "same", projectId: "p1", text: "project one", sourceLabel: "one.txt" },
      { id: "same:2", documentId: "same", projectId: "p2", text: "project two", sourceLabel: "two.txt" }
    ]);
    const removed = await repository.removeDocument("same", "p1");
    expect(removed.ok).toBe(true);
    const p1 = await repository.listDocuments("p1");
    const p2 = await repository.listDocuments("p2");
    expect(p1.ok && p1.value).toEqual([]);
    expect(p2.ok && p2.value).toHaveLength(1);
  });
});
