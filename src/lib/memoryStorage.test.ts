import { describe, expect, it } from "vitest";
import { LocalStorageMemoryRepository, type StorageLike } from "./memoryStorage";
import type { MemoryRecord } from "../core/memory";

class FakeStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const record = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: "memory-1" as MemoryRecord["id"],
  content: "Prefers technical explanations with practical examples",
  category: "preference",
  scope: "profile",
  source: { type: "user_confirmed", label: "User confirmation" },
  tags: ["learning", "style"],
  createdAt: 100,
  updatedAt: 100,
  schemaVersion: 1,
  ...overrides
});

describe("LocalStorageMemoryRepository", () => {
  it("persists, searches by relevance, and deletes records", async () => {
    const storage = new FakeStorage();
    const repository = new LocalStorageMemoryRepository(storage);
    const first = record();
    const second = record({
      id: "memory-2" as MemoryRecord["id"],
      content: "Interested in learning software architecture",
      updatedAt: 200
    });

    expect((await repository.save(first)).ok).toBe(true);
    expect((await repository.save(second)).ok).toBe(true);
    const recent = await repository.list("all", 10);
    expect(recent.ok && recent.value[0].id).toBe(second.id);

    const results = await repository.search("technical examples", "profile", 10);
    expect(results.ok).toBe(true);
    if (results.ok) expect(results.value[0].id).toBe(first.id);

    expect((await repository.delete(first.id)).ok).toBe(true);
    const remaining = await repository.search("learning", "all", 10);
    expect(remaining.ok && remaining.value.map(item => item.id)).toEqual([second.id]);
  });

  it("boosts matching tags while reducing the influence of corpus-wide common terms", async () => {
    const repository = new LocalStorageMemoryRepository(new FakeStorage());
    const broad = record({
      id: "broad" as MemoryRecord["id"],
      content: "Interested in tools and software",
      tags: ["general"],
      updatedAt: 500
    });
    const specific = record({
      id: "specific" as MemoryRecord["id"],
      content: "A note about a project",
      tags: ["typescript", "architecture"],
      updatedAt: 100
    });
    await repository.save(broad);
    await repository.save(specific);

    const results = await repository.search("typescript architecture", "all", 10);
    expect(results.ok && results.value[0].id).toBe(specific.id);
  });

  it("does not silently accept corrupted stored data", async () => {
    const storage = new FakeStorage();
    storage.values.set("nexus-au:memory:v1", "{broken");
    const result = await new LocalStorageMemoryRepository(storage).search("anything", "all", 5);
    expect(result.ok).toBe(false);
  });

  it("filters by memory scope", async () => {
    const storage = new FakeStorage();
    const repository = new LocalStorageMemoryRepository(storage);
    await repository.save(record());
    await repository.save(record({
      id: "memory-2" as MemoryRecord["id"],
      scope: "project",
      projectId: "project-1",
      content: "NEXUS project architecture notes"
    }));

    const results = await repository.search("architecture", "project", 10, "project-1");
    expect(results.ok && results.value).toHaveLength(1);
    expect(results.ok && results.value[0].scope).toBe("project");
  });

  it("returns no results for punctuation-only queries", async () => {
    const repository = new LocalStorageMemoryRepository(new FakeStorage());
    await repository.save(record());
    const results = await repository.search("!!! ...", "all", 10);
    expect(results.ok && results.value).toEqual([]);
  });
});
