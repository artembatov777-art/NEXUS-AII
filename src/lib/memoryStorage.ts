import type { MemoryRecord, MemoryRepository, MemoryScope } from "../core/memory";
import { err, ok, type Result } from "../core/result";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MEMORY_STORAGE_KEY = "nexus-au:memory:v1";

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MemoryRecord>;
  return typeof record.id === "string" &&
    typeof record.content === "string" &&
    typeof record.category === "string" &&
    typeof record.scope === "string" &&
    typeof record.createdAt === "number" &&
    typeof record.updatedAt === "number" &&
    record.schemaVersion === 1 &&
    Array.isArray(record.tags) &&
    !!record.source &&
    typeof record.source.label === "string";
}

function tokenize(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * A deterministic lexical ranker inspired by information-retrieval patterns:
 * inverse document frequency reduces the impact of common terms, while tags
 * receive a modest boost. This is not semantic/vector search.
 */
export function rankMemories(records: MemoryRecord[], query: string): MemoryRecord[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];

  const documents = records.map(record => ({
    record,
    content: new Set(tokenize(record.content)),
    tags: new Set(record.tags.flatMap(tokenize)),
    category: new Set(tokenize(record.category))
  }));

  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    documentFrequency.set(term, documents.filter(document =>
      document.content.has(term) || document.tags.has(term) || document.category.has(term)
    ).length);
  }

  return documents.map(document => {
    let score = 0;
    let matchedTerms = 0;
    for (const term of terms) {
      const contentMatch = document.content.has(term);
      const tagMatch = document.tags.has(term);
      const categoryMatch = document.category.has(term);
      if (!contentMatch && !tagMatch && !categoryMatch) continue;
      matchedTerms += 1;
      const frequency = documentFrequency.get(term) ?? 0;
      const inverseFrequency = Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5));
      score += inverseFrequency * (
        (contentMatch ? 1 : 0) +
        (tagMatch ? 1.35 : 0) +
        (categoryMatch ? 0.5 : 0)
      );
    }

    const searchable = [document.record.content, document.record.category, ...document.record.tags]
      .join(" ").toLocaleLowerCase();
    if (searchable.includes(query.toLocaleLowerCase())) score += 1.5;
    score += (matchedTerms / terms.length) * 0.25;
    return { record: document.record, score, matchedTerms };
  })
    .filter(item => item.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      b.matchedTerms - a.matchedTerms ||
      b.record.updatedAt - a.record.updatedAt
    )
    .map(item => item.record);
}

export class LocalStorageMemoryRepository implements MemoryRepository {
  constructor(
    private readonly storage: StorageLike,
    private readonly key = MEMORY_STORAGE_KEY
  ) {}

  async exportAll(): Promise<Result<MemoryRecord[]>> {
    return this.readAll();
  }

  /** Clear the legacy browser copy only after a successful native migration. */
  clearLegacy(): void {
    this.storage.setItem(this.key, "[]");
  }

  async getById(id: MemoryRecord["id"]): Promise<Result<MemoryRecord | null>> {
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    return ok(loaded.value.find(record => record.id === id) ?? null);
  }

  async list(scope: MemoryScope, limit: number, projectId?: string): Promise<Result<MemoryRecord[]>> {
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    return ok(loaded.value
      .filter(record => (scope === "all" || record.scope === scope) && (scope !== "project" || (!!projectId && record.projectId === projectId)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit));
  }

  async search(query: string, scope: MemoryScope, limit: number, projectId?: string): Promise<Result<MemoryRecord[]>> {
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    const scoped = loaded.value.filter(record => (scope === "all" || record.scope === scope) && (scope !== "project" || (!!projectId && record.projectId === projectId)));
    return ok(rankMemories(scoped, query.trim()).slice(0, limit));
  }

  async save(record: MemoryRecord): Promise<Result<void>> {
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    const next = loaded.value.filter(item => item.id !== record.id);
    next.push(record);
    try {
      this.storage.setItem(this.key, JSON.stringify(next));
      return ok(undefined);
    } catch {
      return err("storage_failed", "Could not save memory to local storage.", true);
    }
  }

  async getByIds(ids: string[]): Promise<Result<MemoryRecord[]>> {
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    const selected = new Set(ids);
    return ok(loaded.value.filter(record => selected.has(record.id)));
  }

  async delete(id: MemoryRecord["id"]): Promise<Result<void>> {
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;
    const next = loaded.value.filter(record => record.id !== id);
    try {
      this.storage.setItem(this.key, JSON.stringify(next));
      return ok(undefined);
    } catch {
      return err("storage_failed", "Could not update local memory storage.", true);
    }
  }

  private readAll(): Result<MemoryRecord[]> {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return ok([]);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isMemoryRecord)) {
        return err("storage_failed", "Memory storage contains invalid or unsupported data.");
      }
      return ok(parsed);
    } catch {
      return err("storage_failed", "Could not read local memory storage.", true);
    }
  }
}
