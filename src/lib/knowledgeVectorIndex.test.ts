import { describe, expect, it } from "vitest";
import { cosineSimilarity, planVectorReconciliation, vectorStorageKey } from "./knowledgeVectorIndex";

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

describe("knowledge vector reconciliation", () => {
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
      { id: vectorStorageKey("p1", "empty"), chunkId: "empty", projectId: "p1", documentId: "doc-empty", vector: [], updatedAt: 1 },
      { id: vectorStorageKey("p1", "nan"), chunkId: "nan", projectId: "p1", documentId: "doc-nan", vector: [Number.NaN], updatedAt: 1 }
    ];
    const plan = planVectorReconciliation(rows, chunks);
    expect(plan.staleIds).toHaveLength(2);
    expect(plan.missingChunks.map(item => item.id)).toEqual(["empty", "nan"]);
  });

  it("removes stale and legacy-keyed vectors and returns missing chunks for re-indexing", () => {
    const chunks = [chunk("a", "p1", "doc-a"), chunk("b", "p1", "doc-b")];
    const rows = [
      { id: vectorStorageKey("p1", "a"), chunkId: "a", projectId: "p1", documentId: "doc-a", vector: [1], updatedAt: 1 },
      { id: "deleted-chunk", projectId: "p1", documentId: "deleted-doc", vector: [1], updatedAt: 1 },
      { id: "b", projectId: "p1", documentId: "doc-b", vector: [1], updatedAt: 1 }
    ];
    const plan = planVectorReconciliation(rows, chunks);
    expect(plan.staleIds).toEqual(["deleted-chunk", "b"]);
    expect(plan.missingChunks.map(item => item.id)).toEqual(["b"]);
  });
});
