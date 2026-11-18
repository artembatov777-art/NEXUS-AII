export const LOCAL_EMBEDDING_MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX";
import type { KnowledgeChunk, KnowledgeVectorIndex } from "../core/knowledge";

export interface VectorRow {
  id: string;
  chunkId?: string;
  modelId?: string;
  projectId: string;
  documentId: string;
  vector: number[];
  updatedAt: number;
}
const DATABASE = "nexus-au-knowledge-vectors";
const STORE = "vectors";

export function vectorStorageKey(projectId: string, chunkId: string): string {
  return `${projectId}\u0000${chunkId}`;
}

export function normalizeVectorRows(value: unknown): VectorRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.id !== "string") return [];
    const row = item as Partial<VectorRow>;
    return [{
      id: row.id!,
      ...(typeof row.chunkId === "string" ? { chunkId: row.chunkId } : {}),
      ...(typeof row.modelId === "string" ? { modelId: row.modelId } : {}),
      projectId: typeof row.projectId === "string" ? row.projectId : "",
      documentId: typeof row.documentId === "string" ? row.documentId : "",
      vector: Array.isArray(row.vector) ? row.vector : [],
      updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0
    }];
  });
}

export function planVectorReconciliation(rows: VectorRow[], chunks: KnowledgeChunk[]): {
  staleIds: string[];
  missingChunks: KnowledgeChunk[];
} {
  const expected = new Map(chunks.map(chunk => [vectorStorageKey(chunk.projectId, chunk.id), chunk]));
  const indexed = new Set<string>();
  const staleIds: string[] = [];
  for (const row of rows) {
    const chunkId = row.chunkId ?? row.id;
    const key = vectorStorageKey(row.projectId, chunkId);
    const chunk = expected.get(key);
    if (row.modelId !== LOCAL_EMBEDDING_MODEL_ID || !Array.isArray(row.vector) || row.vector.length === 0 || !row.vector.every(Number.isFinite) || !chunk || row.id !== key || row.documentId !== chunk.documentId) {
      staleIds.push(row.id);
      continue;
    }
    indexed.add(key);
  }
  return {
    staleIds,
    missingChunks: chunks.filter(chunk => !indexed.has(vectorStorageKey(chunk.projectId, chunk.id)))
  };
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length || left.some(value => !Number.isFinite(value)) || right.some(value => !Number.isFinite(value))) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

/** Ignore vectors from retired embedding models even before a background reconciliation finishes. */
export function rankKnowledgeVectorRows(
  rows: VectorRow[],
  vector: number[],
  projectId: string,
  limit: number
): Array<{ id: string; score: number }> {
  return rows.filter(row => row.projectId === projectId && row.modelId === LOCAL_EMBEDDING_MODEL_ID)
    .map(row => ({ id: row.chunkId ?? row.id, score: cosineSimilarity(vector, row.vector) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(100, limit)));
}

/** Durable browser vector store with composite project/chunk keys and repairable indexing. */
export class IndexedDbKnowledgeVectorIndex implements KnowledgeVectorIndex {
  private database?: Promise<IDBDatabase>;

  async upsert(chunk: KnowledgeChunk, vector: number[]): Promise<void> {
    if (!vector.length || vector.some(value => !Number.isFinite(value))) throw new Error("Invalid embedding vector.");
    const db = await this.open();
    await this.write(db, "readwrite", store => store.put({
      id: vectorStorageKey(chunk.projectId, chunk.id),
      chunkId: chunk.id,
      modelId: LOCAL_EMBEDDING_MODEL_ID,
      projectId: chunk.projectId,
      documentId: chunk.documentId,
      vector,
      updatedAt: Date.now()
    } satisfies VectorRow));
  }

  async removeDocument(documentId: string, projectId: string): Promise<void> {
    const db = await this.open();
    const rows = await this.readAll(db);
    const ids = rows.filter(row => row.documentId === documentId && row.projectId === projectId).map(row => row.id);
    if (!ids.length) return;
    await this.write(db, "readwrite", store => { for (const id of ids) store.delete(id); });
  }

  async removeProject(projectId: string): Promise<void> {
    const db = await this.open();
    const rows = await this.readAll(db);
    const ids = rows.filter(row => row.projectId === projectId).map(row => row.id);
    if (!ids.length) return;
    await this.write(db, "readwrite", store => { for (const id of ids) store.delete(id); });
  }

  /** Removes vectors for deleted/changed chunks and returns chunks that need embeddings. */
  async reconcile(chunks: KnowledgeChunk[]): Promise<KnowledgeChunk[]> {
    const db = await this.open();
    const rows = await this.readAll(db);
    const plan = planVectorReconciliation(rows, chunks);
    if (plan.staleIds.length) {
      await this.write(db, "readwrite", store => { for (const id of plan.staleIds) store.delete(id); });
    }
    return plan.missingChunks;
  }

  async clear(): Promise<void> {
    const db = await this.open();
    await this.write(db, "readwrite", store => store.clear());
  }

  async hasProject(projectId: string): Promise<boolean> {
    const db = await this.open();
    const rows = await this.readAll(db);
    return rows.some(row => row.projectId === projectId);
  }

  async search(vector: number[], projectId: string, limit: number): Promise<Array<{ id: string; score: number }>> {
    const db = await this.open();
    return rankKnowledgeVectorRows(await this.readAll(db), vector, projectId, limit);
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
          // An onblocked request can later succeed after another tab closes.
          // The caller has already received a rejection, so close this late
          // connection instead of leaking an unused database handle.
          if (settled) {
            db.close();
            return;
          }
          settled = true;
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
        request.onerror = () => {
          if (settled) return;
          settled = true;
          reject(request.error ?? new Error("Could not open vector database."));
        };
        request.onblocked = () => {
          if (settled) return;
          settled = true;
          reject(new Error("Vector database upgrade is blocked by another open tab."));
        };
      });
      this.database = pending.catch(error => { this.database = undefined; throw error; });
    }
    return this.database;
  }

  private readAll(db: IDBDatabase): Promise<VectorRow[]> {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      // Keep malformed rows with a usable primary key so reconciliation can
      // delete and rebuild them instead of silently hiding corrupt records.
      request.onsuccess = () => resolve(normalizeVectorRows(request.result));
      request.onerror = () => reject(request.error ?? new Error("Could not read vector database."));
    });
  }

  private write(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Vector database write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Vector database write was aborted."));
    });
  }
}
