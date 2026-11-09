import { describe, expect, it } from "vitest";
import { KnowledgeRetrievalService, type EmbeddingProvider, type KnowledgeChunk, type KnowledgeRepository, type KnowledgeVectorIndex } from "./knowledge";
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
