import { describe, expect, it } from "vitest";
import { KnowledgeRetrievalService, reconcileKnowledgeIndex, type EmbeddingProvider, type KnowledgeChunk, type KnowledgeRepository, type KnowledgeVectorIndex } from "./knowledge";
import { ok } from "./result";

const chunks: KnowledgeChunk[] = [
  { id: "lex", documentId: "doc-a", projectId: "p1", text: "Exact lexical phrase", sourceLabel: "a.txt" },
  { id: "semantic", documentId: "doc-b", projectId: "p1", text: "Related meaning without query terms", sourceLabel: "b.pdf", page: 3 },
  { id: "other-project", documentId: "doc-c", projectId: "p2", text: "Related meaning", sourceLabel: "private.txt" }
];

describe("semantic knowledge retrieval", () => {
  it("merges semantic and lexical results while enforcing project scope", async () => {
    const repository: KnowledgeRepository = {
      add: async () => ok(undefined),
      search: async (_query, projectId) => ok(chunks.filter(chunk => chunk.projectId === projectId && chunk.id === "lex")),
      getByIds: async ids => ok(chunks.filter(chunk => ids.includes(chunk.id))),
      removeDocument: async () => ok(undefined)
    };
    const embeddings: EmbeddingProvider = { embed: async () => ok([[1, 0]]) };
    const vectors: KnowledgeVectorIndex = {
      upsert: async () => undefined,
      removeDocument: async () => undefined,
      hasProject: async () => true,
      search: async (_vector, projectId) => [
        { id: "semantic", score: 0.99 },
        ...(projectId === "p1" ? [{ id: "other-project", score: 1 }] : [])
      ]
    };
    const result = await new KnowledgeRetrievalService(repository, embeddings, vectors).retrieve("exact query", "p1", 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.citations.map(item => item.chunkId)).toContain("semantic");
    expect(result.value.citations.map(item => item.chunkId)).not.toContain("other-project");
    expect(result.value.context).toContain("page 3");
  });

  it("does not invoke the embedding provider when the project has no vector index", async () => {
    const repository: KnowledgeRepository = {
      add: async () => ok(undefined),
      search: async () => ok([]),
      getByIds: async () => ok([]),
      removeDocument: async () => ok(undefined)
    };
    let calls = 0;
    const embeddings: EmbeddingProvider = { embed: async () => { calls += 1; return ok([[1, 0]]); } };
    const vectors: KnowledgeVectorIndex = {
      upsert: async () => undefined,
      removeDocument: async () => undefined,
      hasProject: async () => false,
      search: async () => []
    };
    await new KnowledgeRetrievalService(repository, embeddings, vectors).retrieve("query", "empty-project");
    expect(calls).toBe(0);
  });
});

describe("semantic index reconciliation", () => {
  const chunk = (id: string): KnowledgeChunk => ({
    id, documentId: "doc-" + id, projectId: "project-a", text: "text " + id, sourceLabel: "notes.md"
  });

  it("rebuilds missing vectors in bounded batches and reports completion", async () => {
    const chunks = [chunk("a"), chunk("b"), chunk("c")];
    const batches: string[][] = [];
    const upserts: string[] = [];
    const repository: KnowledgeRepository = {
      add: async () => ok(undefined),
      exportAll: async () => ok(chunks),
      search: async () => ok([]),
      removeDocument: async () => ok(undefined)
    };
    const vectors: KnowledgeVectorIndex = {
      upsert: async item => { upserts.push(item.id); },
      removeDocument: async () => undefined,
      search: async () => [],
      reconcile: async () => chunks
    };
    const embeddings: EmbeddingProvider = {
      embed: async texts => { batches.push(texts); return ok(texts.map((_, index) => [index + 1, 0])); }
    };
    const result = await reconcileKnowledgeIndex(repository, vectors, embeddings, () => true, 2);
    expect(result).toEqual({ ok: true, value: { totalChunks: 3, indexedChunks: 3, remainingChunks: 0 } });
    expect(batches).toEqual([["text a", "text b"], ["text c"]]);
    expect(upserts).toEqual(["a", "b", "c"]);
  });

  it("preserves completed batches and returns cancellation so the next startup can resume", async () => {
    const chunks = [chunk("a"), chunk("b")];
    let active = true;
    const upserts: string[] = [];
    const repository: KnowledgeRepository = {
      add: async () => ok(undefined), exportAll: async () => ok(chunks),
      search: async () => ok([]), removeDocument: async () => ok(undefined)
    };
    const vectors: KnowledgeVectorIndex = {
      upsert: async item => { upserts.push(item.id); },
      removeDocument: async () => undefined, search: async () => [],
      reconcile: async () => chunks
    };
    const embeddings: EmbeddingProvider = {
      embed: async texts => { active = false; return ok(texts.map(() => [1, 0])); }
    };
    const result = await reconcileKnowledgeIndex(repository, vectors, embeddings, () => active, 1);
    expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(upserts).toEqual([]);
  });

  it("fails visibly when embeddings or vector persistence fail", async () => {
    const chunks = [chunk("a")];
    const repository: KnowledgeRepository = {
      add: async () => ok(undefined), exportAll: async () => ok(chunks),
      search: async () => ok([]), removeDocument: async () => ok(undefined)
    };
    const vectors: KnowledgeVectorIndex = {
      upsert: async () => { throw new Error("IndexedDB quota exceeded"); },
      removeDocument: async () => undefined, search: async () => [],
      reconcile: async () => chunks
    };
    const embeddings: EmbeddingProvider = { embed: async () => ok([[Number.NaN]]) };
    const invalid = await reconcileKnowledgeIndex(repository, vectors, embeddings);
    expect(invalid).toMatchObject({ ok: false, error: { code: "validation" } });
    const validEmbeddings: EmbeddingProvider = { embed: async () => ok([[1, 0]]) };
    const failedWrite = await reconcileKnowledgeIndex(repository, vectors, validEmbeddings);
    expect(failedWrite).toMatchObject({ ok: false, error: { code: "storage_failed", message: "IndexedDB quota exceeded" } });
  });
});
