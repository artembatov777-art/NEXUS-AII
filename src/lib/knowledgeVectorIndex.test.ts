import { describe, expect, it, vi } from "vitest";
import { cosineSimilarity, IndexedDbKnowledgeVectorIndex, LOCAL_EMBEDDING_MODEL_ID, normalizeVectorRows, planVectorReconciliation, rankKnowledgeVectorRows, vectorStorageKey } from "./knowledgeVectorIndex";

describe("IndexedDB connection lifecycle", () => {
  it("closes a database connection if a previously blocked open request succeeds late", async () => {
    const request = {
      onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
      result: null as unknown as IDBDatabase,
      error: null
    } as IDBOpenDBRequest;
    const open = vi.fn(() => request);
    vi.stubGlobal("indexedDB", { open });
    try {
      const index = new IndexedDbKnowledgeVectorIndex();
      const pending = index.hasProject("project-1");
      request.onblocked?.(new Event("blocked"));
      await expect(pending).rejects.toThrow(/blocked by another open tab/i);
      const close = vi.fn();
      request.result = { close } as unknown as IDBDatabase;
      request.onsuccess?.(new Event("success"));
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("knowledge vector index similarity", () => {
  it("scores identical normalized vectors at one", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });
  it("returns zero for orthogonal or invalid dimensions", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
  });
  it("clamps negative similarity to zero", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });
  it("rejects non-finite vectors", () => {
    expect(cosineSimilarity([1, Number.NaN], [1, 0])).toBe(0);
  });
});


describe("active embedding model search", () => {
  it("never mixes retired model vectors into current semantic results", () => {
    const rows = [
      { id: "current-key", chunkId: "current", modelId: LOCAL_EMBEDDING_MODEL_ID, projectId: "p1", documentId: "doc", vector: [1, 0], updatedAt: 2 },
      { id: "old-key", chunkId: "old", modelId: "previous-model", projectId: "p1", documentId: "doc", vector: [1, 0], updatedAt: 1 }
    ];
    expect(rankKnowledgeVectorRows(rows, [1, 0], "p1", 10)).toEqual([{ id: "current", score: 1 }]);
  });
});

describe("knowledge vector reconciliation", () => {
  it("retains malformed keyed rows for cleanup instead of hiding them", () => {
    const rows = normalizeVectorRows([
      { id: "corrupt-vector", projectId: "p1", documentId: "doc", vector: { invalid: true } },
      { id: "nan-vector", projectId: "p1", documentId: "doc-2", vector: [Number.NaN] },
      { projectId: "p1", documentId: "missing-id", vector: [1] },
      null
    ]);
    expect(rows).toHaveLength(2);
    const plan = planVectorReconciliation(rows, []);
    expect(plan.staleIds).toEqual(["corrupt-vector", "nan-vector"]);
  });

  const chunk = (id: string, projectId: string, documentId: string) => ({
    id, projectId, documentId, text: "source text", sourceLabel: "source.md"
  });

  it("uses project-composite keys so identical chunk IDs cannot collide across projects", () => {
    expect(vectorStorageKey("p1", "same")).not.toBe(vectorStorageKey("p2", "same"));
    const chunks = [chunk("same", "p1", "d1"), chunk("same", "p2", "d2")];
    const plan = planVectorReconciliation([], chunks);
    expect(plan.missingChunks).toHaveLength(2);
  });

  it("treats empty or non-finite vectors as stale and schedules re-indexing", () => {
    const chunks = [chunk("empty", "p1", "doc-empty"), chunk("nan", "p1", "doc-nan")];
    const rows = [
      { id: vectorStorageKey("p1", "empty"), chunkId: "empty", modelId: LOCAL_EMBEDDING_MODEL_ID, projectId: "p1", documentId: "doc-empty", vector: [], updatedAt: 1 },
      { id: vectorStorageKey("p1", "nan"), chunkId: "nan", modelId: LOCAL_EMBEDDING_MODEL_ID, projectId: "p1", documentId: "doc-nan", vector: [Number.NaN], updatedAt: 1 }
    ];
    const plan = planVectorReconciliation(rows, chunks);
    expect(plan.staleIds).toHaveLength(2);
    expect(plan.missingChunks.map(item => item.id)).toEqual(["empty", "nan"]);
  });

  it("rebuilds vectors created by a different or unknown embedding model", () => {
    const chunks = [chunk("current", "p1", "doc-current")];
    const rows = [{
      id: vectorStorageKey("p1", "current"), chunkId: "current",
      modelId: "previous-embedding-model", projectId: "p1",
      documentId: "doc-current", vector: [1, 0], updatedAt: 1
    }];
    const plan = planVectorReconciliation(rows, chunks);
    expect(plan.staleIds).toEqual([vectorStorageKey("p1", "current")]);
    expect(plan.missingChunks.map(item => item.id)).toEqual(["current"]);
  });

  it("removes stale and legacy-keyed vectors and returns missing chunks for re-indexing", () => {
    const chunks = [chunk("a", "p1", "doc-a"), chunk("b", "p1", "doc-b")];
    const rows = [
      { id: vectorStorageKey("p1", "a"), chunkId: "a", modelId: LOCAL_EMBEDDING_MODEL_ID, projectId: "p1", documentId: "doc-a", vector: [1], updatedAt: 1 },
      { id: "deleted-chunk", projectId: "p1", documentId: "deleted-doc", vector: [1], updatedAt: 1 },
      { id: "b", projectId: "p1", documentId: "doc-b", vector: [1], updatedAt: 1 }
    ];
    const plan = planVectorReconciliation(rows, chunks);
    expect(plan.staleIds).toEqual(["deleted-chunk", "b"]);
    expect(plan.missingChunks.map(item => item.id)).toEqual(["b"]);
  });
});
