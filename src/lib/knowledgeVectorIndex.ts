import type { KnowledgeChunk, KnowledgeVectorIndex } from "../core/knowledge";

interface VectorRow {
  id: string;
  projectId: string;
  documentId: string;
  vector: number[];
  updatedAt: number;
}
const DATABASE = "nexus-au-knowledge-vectors";
const STORE = "vectors";

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

/** Durable browser vector store. Data is scoped by project and never searched across project IDs. */
export class IndexedDbKnowledgeVectorIndex implements KnowledgeVectorIndex {
  private database?: Promise<IDBDatabase>;

  async upsert(chunk: KnowledgeChunk, vector: number[]): Promise<void> {
    if (!vector.length || vector.some(value => !Number.isFinite(value))) throw new Error("Invalid embedding vector.");
    const db = await this.open();
    await this.write(db, "readwrite", store => store.put({
      id: chunk.id, projectId: chunk.projectId, documentId: chunk.documentId, vector, updatedAt: Date.now()
    } satisfies VectorRow));
  }

  async removeDocument(documentId: string, projectId: string): Promise<void> {
    const db = await this.open();
    const rows = await this.readAll(db);
    const ids = rows.filter(row => row.documentId === documentId && row.projectId === projectId).map(row => row.id);
    if (!ids.length) return;
    await this.write(db, "readwrite", store => { for (const id of ids) store.delete(id); });
  }

  async search(vector: number[], projectId: string, limit: number): Promise<Array<{ id: string; score: number }>> {
    const db = await this.open();
    const rows = await this.readAll(db);
    return rows.filter(row => row.projectId === projectId)
      .map(row => ({ id: row.id, score: cosineSimilarity(vector, row.vector) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(100, limit)));
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable in this runtime."));
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open vector database."));
    });
  }

  private readAll(db: IDBDatabase): Promise<VectorRow[]> {
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as VectorRow[]).filter(row =>
        row && typeof row.id === "string" && typeof row.projectId === "string" &&
        typeof row.documentId === "string" && Array.isArray(row.vector) &&
        row.vector.every(Number.isFinite)
      ));
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
