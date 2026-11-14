import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MemoryRecord, MemoryRepository, MemoryScope } from "../core/memory";
import type { KnowledgeChunk, KnowledgeRepository, MemorySearchRepository } from "../core/knowledge";
import { err, ok, type Result } from "../core/result";
import { LocalStorageMemoryRepository, rankMemories, type StorageLike } from "./memoryStorage";
import { LocalStorageKnowledgeRepository } from "./knowledgeStorage";

// Separate UI panels share one renderer and one localStorage object. Coordinate
// legacy imports across repository instances so simultaneous panel startup cannot
// race duplicate migrations or re-import a stale browser snapshot.
const memoryMigrations = new WeakMap<StorageLike, Promise<void>>();
const knowledgeMigrations = new WeakMap<StorageLike, Promise<void>>();


export function tokenizeKnowledgeTerms(value: string): string[] {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
}

function failure(error: unknown, fallback: string): Result<never> {
  return err("storage_failed", error instanceof Error ? error.message : fallback, true);
}


export class WorkspaceMemoryRepository implements MemoryRepository, MemorySearchRepository {
  private readonly local: LocalStorageMemoryRepository;
  private migration?: Promise<void>;

  constructor(private readonly storage: StorageLike) {
    this.local = new LocalStorageMemoryRepository(storage);
  }

  /**
   * Import legacy browser records once per repository instance. The promise is
   * only a migration lock: it must not become a cache of the live native data.
   */
  private async ensureMigrated(): Promise<void> {
    if (!isTauri()) return;
    if (!this.migration) {
      let pending = memoryMigrations.get(this.storage);
      if (!pending) {
        pending = (async () => {
          const nativeRecords = await invoke<MemoryRecord[]>("load_memories");
          const legacy = await this.local.exportAll();
          if (!legacy.ok) throw new Error(legacy.error.message);

          const existing = new Set(nativeRecords.map(record => record.id));
          for (const record of legacy.value) {
            if (existing.has(record.id)) continue;
            await invoke("save_memory", { record });
            existing.add(record.id);
          }
          // Leaving the old copy in localStorage would resurrect records deleted
          // from SQLite on the next app launch. Clear only after every write succeeds.
          this.local.clearLegacy();
        })();
        memoryMigrations.set(this.storage, pending);
        void pending.catch(() => {
          if (memoryMigrations.get(this.storage) === pending) memoryMigrations.delete(this.storage);
        });
      }
      this.migration = pending.catch(error => {
        this.migration = undefined;
        throw error;
      });
    }
    await this.migration;
  }

  private async all(): Promise<MemoryRecord[]> {
    if (!isTauri()) {
      const result = await this.local.exportAll();
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    }

    await this.ensureMigrated();
    // Always read the database again. Multiple panels/services own separate
    // repository instances, so caching this result would make them stale.
    return invoke<MemoryRecord[]>("load_memories");
  }

  async getById(id: MemoryRecord["id"]): Promise<Result<MemoryRecord | null>> {
    try {
      return ok((await this.all()).find(record => record.id === id) ?? null);
    } catch (error) {
      return failure(error, "Could not load memory.");
    }
  }

  async getByIds(ids: string[]): Promise<Result<MemoryRecord[]>> {
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== "string" || !id.trim() || id.length > 128)) {
      return err("validation", "Memory IDs are invalid or exceed the lookup limit.");
    }
    try {
      const selected = new Set(ids);
      return ok((await this.all()).filter(record => selected.has(record.id)));
    } catch (error) {
      return failure(error, "Could not load selected memories.");
    }
  }

  async exportAll(): Promise<Result<MemoryRecord[]>> {
    try {
      return ok(await this.all());
    } catch (error) {
      return failure(error, "Could not export memories.");
    }
  }

  async list(scope: MemoryScope, limit: number, projectId?: string): Promise<Result<MemoryRecord[]>> {
    try {
      const records = await this.all();
      return ok(records
        .filter(record => (scope === "all" || record.scope === scope) &&
          (scope !== "project" || (!!projectId && record.projectId === projectId)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit));
    } catch (error) {
      return failure(error, "Could not load memories.");
    }
  }

  async search(query: string, scope: MemoryScope, limit: number, projectId?: string): Promise<Result<MemoryRecord[]>> {
    try {
      const records = await this.all();
      const scoped = records.filter(record => (scope === "all" || record.scope === scope) &&
        (scope !== "project" || (!!projectId && record.projectId === projectId)));
      return ok(rankMemories(scoped, query).slice(0, limit));
    } catch (error) {
      return failure(error, "Could not search memories.");
    }
  }

  async save(record: MemoryRecord): Promise<Result<void>> {
    if (!isTauri()) return this.local.save(record);
    try {
      await this.ensureMigrated();
      await invoke("save_memory", { record });
      return ok(undefined);
    } catch (error) {
      return failure(error, "Could not save memory.");
    }
  }

  async delete(id: MemoryRecord["id"]): Promise<Result<void>> {
    if (!isTauri()) return this.local.delete(id);
    try {
      await this.ensureMigrated();
      await invoke("delete_memory", { id });
      return ok(undefined);
    } catch (error) {
      return failure(error, "Could not delete memory.");
    }
  }
}

export interface KnowledgeDocumentSummary { documentId:string; fileName:string; chunkCount:number; characterCount:number; }
export class WorkspaceKnowledgeRepository implements KnowledgeRepository {
  private readonly local: LocalStorageKnowledgeRepository;
  private migration?: Promise<void>;

  constructor(private readonly storage: StorageLike) {
    this.local = new LocalStorageKnowledgeRepository(storage);
  }

  /** Import legacy chunks once; never cache the mutable native knowledge set. */
  private async ensureMigrated(): Promise<void> {
    if (!isTauri()) return;
    if (!this.migration) {
      let pending = knowledgeMigrations.get(this.storage);
      if (!pending) {
        pending = (async () => {
          const nativeChunks = await invoke<KnowledgeChunk[]>("load_knowledge_chunks");
          const legacy = await this.local.exportAll();
          if (!legacy.ok) throw new Error(legacy.error.message);

          const existing = new Set(nativeChunks.map(chunk => chunk.id));
          const missing = legacy.value.filter(chunk => !existing.has(chunk.id));
          if (missing.length) await invoke("save_knowledge_chunks", { chunks: missing });
          // Prevent deleted native documents from being re-imported on next launch.
          this.local.clearLegacy();
        })();
        knowledgeMigrations.set(this.storage, pending);
        void pending.catch(() => {
          if (knowledgeMigrations.get(this.storage) === pending) knowledgeMigrations.delete(this.storage);
        });
      }
      this.migration = pending.catch(error => {
        this.migration = undefined;
        throw error;
      });
    }
    await this.migration;
  }

  private async all(): Promise<KnowledgeChunk[]> {
    if (!isTauri()) {
      const exported = await this.local.exportAll();
      if (!exported.ok) throw new Error(exported.error.message);
      return exported.value;
    }

    await this.ensureMigrated();
    // Separate UI services hold separate repository instances. Reload from
    // SQLite on every operation so imports/deletions are visible immediately.
    return invoke<KnowledgeChunk[]>("load_knowledge_chunks");
  }

  private async persist(chunks: KnowledgeChunk[]): Promise<Result<void>> {
    if (!isTauri()) return this.local.add(chunks);
    try {
      await this.ensureMigrated();
      await invoke("save_knowledge_chunks", { chunks });
      return ok(undefined);
    } catch (error) {
      return failure(error, "Could not persist project knowledge.");
    }
  }

  async add(chunks: KnowledgeChunk[]): Promise<Result<void>> {
    if (!isTauri()) return this.local.add(chunks);
    try {
      await this.ensureMigrated();
      // The native command is an atomic ID-based UPSERT. Send only the new
      // chunks instead of rewriting a stale full snapshot that could resurrect
      // a document deleted by another panel between read and write.
      await invoke("save_knowledge_chunks", { chunks });
      return ok(undefined);
    } catch (error) {
      return failure(error, "Could not persist project knowledge.");
    }
  }

  async replaceDocument(documentId: string, projectId: string, chunks: KnowledgeChunk[]): Promise<Result<void>> {
    if (!isTauri()) return this.local.replaceDocument(documentId, projectId, chunks);
    try {
      await this.ensureMigrated();
      await invoke("replace_knowledge_document", { documentId, projectId, chunks });
      return ok(undefined);
    } catch (error) {
      return failure(error, "Could not replace project knowledge document.");
    }
  }

  async exportAll(): Promise<Result<KnowledgeChunk[]>> {
    return this.readResult();
  }

  async getByIds(ids: string[]): Promise<Result<KnowledgeChunk[]>> {
    const all = await this.readResult();
    if (!all.ok) return all;
    const set = new Set(ids);
    return ok(all.value.filter(chunk => set.has(chunk.id)));
  }

  async search(query: string, projectId: string, limit: number): Promise<Result<KnowledgeChunk[]>> {
    if (!isTauri()) return this.local.search(query, projectId, limit);
    const all = await this.readResult();
    if (!all.ok) return all;
    const terms = tokenizeKnowledgeTerms(query);
    const ranked = all.value
      .filter(chunk => chunk.projectId === projectId)
      .map(chunk => ({ chunk, score: terms.reduce((count, term) => count + (chunk.text.toLocaleLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    return ok(ranked.slice(0, limit).map(item => item.chunk));
  }

  async searchAll(query: string, limit: number): Promise<Result<KnowledgeChunk[]>> {
    if (!query.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return err("validation", "Workspace knowledge search query or limit is invalid.");
    }
    const all = await this.readResult();
    if (!all.ok) return all;
    const terms = tokenizeKnowledgeTerms(query);
    if (!terms.length) return ok([]);
    const ranked = all.value
      .map(chunk => ({ chunk, score: terms.reduce((count, term) => count + (chunk.text.toLocaleLowerCase().includes(term) ? 1 : 0), 0) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
    return ok(ranked.slice(0, limit).map(item => item.chunk));
  }

  async removeDocument(documentId: string, projectId: string): Promise<Result<void>> {
    if (!isTauri()) return this.local.removeDocument(documentId, projectId);
    try {
      await this.ensureMigrated();
      await invoke("delete_knowledge_document", { documentId, projectId });
      return ok(undefined);
    } catch (error) {
      return failure(error, "Could not remove project knowledge document.");
    }
  }

  async listDocuments(projectId: string): Promise<Result<KnowledgeDocumentSummary[]>> {
    const all = await this.readResult();
    if (!all.ok) return all;
    const grouped = new Map<string, KnowledgeDocumentSummary>();
    for (const chunk of all.value.filter(item => item.projectId === projectId)) {
      const item = grouped.get(chunk.documentId) ?? {
        documentId: chunk.documentId,
        fileName: chunk.sourceLabel,
        chunkCount: 0,
        characterCount: 0
      };
      item.chunkCount += 1;
      item.characterCount += chunk.text.length;
      grouped.set(chunk.documentId, item);
    }
    return ok([...grouped.values()].sort((a, b) => a.fileName.localeCompare(b.fileName)));
  }

  private async readResult(): Promise<Result<KnowledgeChunk[]>> {
    try {
      return ok(await this.all());
    } catch (error) {
      return failure(error, "Could not load project knowledge.");
    }
  }
}
