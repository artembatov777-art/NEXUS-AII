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

export class LocalStorageMemoryRepository implements MemoryRepository {
  constructor(
    private readonly storage: StorageLike,
    private readonly key = MEMORY_STORAGE_KEY
  ) {}

  async search(query: string, scope: MemoryScope, limit: number): Promise<Result<MemoryRecord[]>> {
    const loaded = this.readAll();
    if (!loaded.ok) return loaded;

    const normalized = query.trim().toLocaleLowerCase();
    const terms = [...new Set(tokenize(normalized))];
    const ranked = loaded.value
      .filter(record => scope === "all" || record.scope === scope)
      .map(record => {
        const searchable = [record.content, record.category, ...record.tags].join(" ").toLocaleLowerCase();
        const tokens = tokenize(searchable);
        const matched = terms.filter(term => tokens.includes(term)).length;
        const phraseBonus = searchable.includes(normalized) ? 3 : 0;
        const score = matched * 2 + phraseBonus;
        return { record, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt)
      .slice(0, limit)
      .map(item => item.record);

    return ok(ranked);
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
      return err("storage_failed", "Could not read memory from local storage.", true);
    }
  }
}
