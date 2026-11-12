import { describe, expect, it } from "vitest";
import { MemoryService, type MemoryRecord, type MemoryRepository, type MemoryId } from "./memory";
import { err, ok, type Result } from "./result";

class FakeMemoryRepository implements MemoryRepository {
  records = new Map<MemoryId, MemoryRecord>();

  async list(scope: "all" | "profile" | "project" | "conversation", limit: number): Promise<Result<MemoryRecord[]>> {
    return ok([...this.records.values()].filter(record => scope === "all" || record.scope === scope).slice(0, limit));
  }

  async getById(id: MemoryId): Promise<Result<MemoryRecord | null>> {
    return ok(this.records.get(id) ?? null);
  }

  async search(query: string, scope: "all" | "profile" | "project" | "conversation", limit: number): Promise<Result<MemoryRecord[]>> {
    const matches = [...this.records.values()].filter(record =>
      (scope === "all" || record.scope === scope) &&
      record.content.toLowerCase().includes(query.toLowerCase())
    );
    return ok(matches.slice(0, limit));
  }

  async save(record: MemoryRecord): Promise<Result<void>> {
    this.records.set(record.id, record);
    return ok(undefined);
  }

  async delete(id: MemoryId): Promise<Result<void>> {
    this.records.delete(id);
    return ok(undefined);
  }
}

function setup() {
  const repository = new FakeMemoryRepository();
  let sequence = 0;
  const service = new MemoryService(
    repository,
    { memoryId: () => `memory-${++sequence}` as MemoryId },
    { now: () => 1_800_000_000_000 }
  );
  return { service, repository };
}

const input = {
  content: "  Prefers concise technical explanations.  ",
  category: "preference" as const,
  scope: "profile" as const,
  source: { type: "user_confirmed" as const, label: "Direct user confirmation" },
  tags: [" Writing ", "writing", "", "TECH"]
};

describe("MemoryService", () => {
  it("saves a normalized memory only after explicit confirmation", async () => {
    const { service, repository } = setup();
    const result = await service.remember(input, { confirmedByUser: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe("Prefers concise technical explanations.");
    expect(result.value.tags).toEqual(["writing", "tech"]);
    expect(repository.records.size).toBe(1);
  });

  it("rejects empty and oversized memory content", async () => {
    const { service, repository } = setup();
    const empty = await service.remember({ ...input, content: "   " }, { confirmedByUser: true });
    const oversized = await service.remember({ ...input, content: "x".repeat(4_001) }, { confirmedByUser: true });

    expect(empty.ok).toBe(false);
    expect(oversized.ok).toBe(false);
    expect(repository.records.size).toBe(0);
  });

  it("validates search input and limits", async () => {
    const { service } = setup();
    expect((await service.search("  ")).ok).toBe(false);
    expect((await service.search("preference", "all", 51)).ok).toBe(false);
    expect((await service.search("preference", "all", 5)).ok).toBe(true);
  });

  it("searches by scope and can forget a record", async () => {
    const { service, repository } = setup();
    const saved = await service.remember(input, { confirmedByUser: true });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const found = await service.search("technical", "profile");
    expect(found.ok && found.value).toHaveLength(1);

    const forgotten = await service.forget(saved.value.id);
    expect(forgotten.ok).toBe(true);
    expect(repository.records.size).toBe(0);
  });

  it("revises an existing memory while preserving its original provenance and creation time", async () => {
    const { service } = setup();
    const saved = await service.remember(input, { confirmedByUser: true });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const revised = await service.revise(saved.value.id, { content: "Updated preference", tags: ["updated"] });
    expect(revised.ok).toBe(true);
    if (revised.ok) {
      expect(revised.value.content).toBe("Updated preference");
      expect(revised.value.createdAt).toBe(saved.value.createdAt);
      expect(revised.value.source).toEqual(saved.value.source);
      expect(revised.value.tags).toEqual(["updated"]);
    }
  });

  it("revises records beyond the first 200 without truncating lookup", async () => {
    const { service, repository } = setup();
    for (let index = 0; index < 250; index += 1) {
      const id = `memory-${index}` as MemoryId;
      repository.records.set(id, {
        id, content: `Memory ${index}`, category: "fact", scope: "profile",
        source: { type: "user_confirmed", label: "Manual" }, tags: [],
        createdAt: index, updatedAt: index, schemaVersion: 1
      });
    }
    const result = await service.revise("memory-249" as MemoryId, { content: "Updated final memory" });
    expect(result.ok && result.value.content).toBe("Updated final memory");
  });

  it("passes repository failures through unchanged", async () => {
    const failing: MemoryRepository = {
      list: async () => err("storage_failed", "Storage unavailable"),
      search: async () => err("storage_failed", "Storage unavailable"),
      getById: async () => err("storage_failed", "Storage unavailable"),
      save: async () => err("storage_failed", "Storage unavailable"),
      delete: async () => err("storage_failed", "Storage unavailable")
    };
    const service = new MemoryService(failing, { memoryId: () => "x" as MemoryId }, { now: () => 1 });
    const result = await service.remember(input, { confirmedByUser: true });
    expect(result).toEqual({ ok: false, error: { code: "storage_failed", message: "Storage unavailable", retryable: false } });
  });
});
