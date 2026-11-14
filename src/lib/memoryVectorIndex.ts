import type { MemoryRecord, MemoryScope } from "../core/memory";
import type { VectorMemoryIndex } from "../core/knowledge";
import { LOCAL_EMBEDDING_MODEL_ID, cosineSimilarity } from "./knowledgeVectorIndex";

export interface MemoryVectorRow {
  id: string;
  modelId: string;
  scope: MemoryRecord["scope"];
  projectId?: string;
  vector: number[];
  updatedAt: number;
}

const DATABASE = "nexus-au-memory-vectors";
const STORE = "memory-vectors";

export function normalizeMemoryVectorRows(value: unknown): MemoryVectorRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string") return [];
    const row = item as Partial<MemoryVectorRow>;
    const scope = row.scope;
    if (scope !== "profile" && scope !== "project" && scope !== "conversation") return [];
    return [{
      id: row.id!,
      modelId: typeof row.modelId === "string" ? row.modelId : "",
      scope,
      ...(typeof row.projectId === "string" ? { projectId: row.projectId } : {}),
      vector: Array.isArray(row.vector) ? row.vector : [],
      updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : -1
    }];
  });
}

export function planMemoryVectorReconciliation(rows: MemoryVectorRow[], records: MemoryRecord[]): {
  staleIds: string[];
  missingRecords: MemoryRecord[];
} {
  const expected = new Map<string, MemoryRecord>(records.map(record => [record.id, record]));
  const indexed = new Set<string>();
  const staleIds: string[] = [];
  for (const row of rows) {
    const record = expected.get(row.id);
    if (row.modelId !== LOCAL_EMBEDDING_MODEL_ID || !row.vector.length ||
        !row.vector.every(Number.isFinite) || !record ||
        row.scope !== record.scope || row.projectId !== record.projectId ||
        row.updatedAt !== record.updatedAt) {
      staleIds.push(row.id);
      continue;
    }
    indexed.add(row.id);
  }
  return {
    staleIds,
    missingRecords: records.filter(record => !indexed.has(record.id))
  };
}

export function rankMemoryVectorRows(
  rows: MemoryVectorRow[],
  vector: number[],
  scope: MemoryScope,
  limit: number,
  projectId?: string
): Array<{ id: string; score: number }> {
  return rows.filter(row =>
    row.modelId === LOCAL_EMBEDDING_MODEL_ID &&
    (scope === "all" || row.scope === scope) &&
    (scope !== "project" || (!!projectId && row.projectId === projectId))
  ).map(row => ({ id: row.id, score: cosineSimilarity(vector, row.vector) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(100, limit)));
}

/** Durable semantic index for owner-approved memories, isolated by scope and project. */
export class IndexedDbMemoryVectorIndex implements VectorMemoryIndex {
  private database?: Promise<IDBDatabase>;

  async upsert(record: MemoryRecord, vector: number[]): Promise<void> {
    if (!vector.length || vector.some(value => !Number.isFinite(value))) throw new Error("Invalid memory embedding vector.");
    const db = await this.open();
    await this.write(db, store => store.put({
      id: record.id,
      modelId: LOCAL_EMBEDDING_MODEL_ID,
      scope: record.scope,
      ...(record.projectId ? { projectId: record.projectId } : {}),
      vector,
      updatedAt: record.updatedAt
    } satisfies MemoryVectorRow));
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    await this.write(db, store => store.delete(id));
  }

  async reconcile(records: MemoryRecord[]): Promise<MemoryRecord[]> {
    const db = await this.open();
    const rows = await this.readAll(db);
    const plan = planMemoryVectorReconciliation(rows, records);
    if (plan.staleIds.length) {
      await this.write(db, store => { for (const id of plan.staleIds) store.delete(id); });
    }
    return plan.missingRecords;
  }

  async search(vector: number[], scope: MemoryScope, limit: number, projectId?: string): Promise<Array<{ id: string; score: number }>> {
    const db = await this.open();
    return rankMemoryVectorRows(await this.readAll(db), vector, scope, limit, projectId);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    await this.write(db, store => store.clear());
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable in this runtime."));
    if (!this.database) {
      const pending = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        let settled = false;
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        };
        request.onsuccess = () => {
          const db = request.result;
          if (settled) { db.close(); return; }
          settled = true;
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
        request.onerror = () => {
          if (settled) return;
          settled = true;
          reject(request.error ?? new Error("Could not open memory vector database."));
        };
        request.onblocked = () => {
          if (settled) return;
          settled = true;
          reject(new Error("Memory vector database upgrade is blocked by another open tab."));
        };
      });
      this.database = pending.catch(error => { this.database = undefined; throw error; });
    }
    return this.database;
  }

  private readAll(db: IDBDatabase): Promise<MemoryVectorRow[]> {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(normalizeMemoryVectorRows(request.result));
      request.onerror = () => reject(request.error ?? new Error("Could not read memory vector database."));
    });
  }

  private write(db: IDBDatabase, action: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Memory vector database write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Memory vector database write was aborted."));
    });
  }
}
