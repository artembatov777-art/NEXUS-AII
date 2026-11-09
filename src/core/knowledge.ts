import type { MemoryRecord, MemoryScope } from "./memory";
import type { Result } from "./result";
import { err, ok } from "./result";

export interface EmbeddingProvider {
  embed(texts: string[], signal?: AbortSignal): Promise<Result<number[][]>>;
}
export interface VectorMemoryIndex {
  upsert(id: string, vector: number[]): Promise<void>;
  remove(id: string): Promise<void>;
  search(vector: number[], scope: MemoryScope, limit: number): Promise<Array<{ id: string; score: number }>>;
}
export interface MemorySearchRepository {
  search(query: string, scope: MemoryScope, limit: number): Promise<Result<MemoryRecord[]>>;
  getByIds(ids: string[]): Promise<Result<MemoryRecord[]>>;
}
export interface RankedMemory { record: MemoryRecord; score: number; lexicalScore: number; semanticScore: number; }

/** Hybrid retrieval: lexical recall remains available offline; embeddings add semantic recall when configured. */
export class HybridMemoryRetriever {
  constructor(
    private readonly repository: MemorySearchRepository,
    private readonly embeddings?: EmbeddingProvider,
    private readonly vectors?: VectorMemoryIndex,
    private readonly semanticWeight = 0.55
  ) {
    if (semanticWeight < 0 || semanticWeight > 1) throw new Error("semanticWeight must be between 0 and 1");
  }

  async search(query: string, scope: MemoryScope = "all", limit = 10, signal?: AbortSignal): Promise<Result<RankedMemory[]>> {
    const normalized = query.trim();
    if (!normalized || normalized.length > 500 || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return err("validation", "Memory search query or result limit is invalid.");
    }
    const lexical = await this.repository.search(normalized, scope, Math.min(100, limit * 5));
    if (!lexical.ok) return lexical;
    const lexicalScores = new Map(lexical.value.map((record, index) => [record.id, 1 / (index + 1)]));
    if (!this.embeddings || !this.vectors) {
      return ok(lexical.value.slice(0, limit).map(record => ({ record, score: lexicalScores.get(record.id) ?? 0, lexicalScore: lexicalScores.get(record.id) ?? 0, semanticScore: 0 })));
    }
    if (signal?.aborted) return err("cancelled", "Memory retrieval was cancelled.");
    const embedded = await this.embeddings.embed([normalized], signal);
    if (!embedded.ok) {
      return ok(lexical.value.slice(0, limit).map(record => ({ record, score: lexicalScores.get(record.id) ?? 0, lexicalScore: lexicalScores.get(record.id) ?? 0, semanticScore: 0 })));
    }
    const vector = embedded.value[0];
    if (!vector || vector.length === 0 || vector.some(value => !Number.isFinite(value))) return err("validation", "Embedding provider returned an invalid vector.");
    const semantic = await this.vectors.search(vector, scope, Math.min(100, limit * 5));
    const semanticScores = new Map(semantic.map(item => [item.id, Math.max(0, Math.min(1, item.score))]));
    const ids = [...new Set([...lexicalScores.keys(), ...semanticScores.keys()])];
    const loaded = await this.repository.getByIds(ids);
    if (!loaded.ok) return loaded;
    const lexicalMax = Math.max(1, ...lexicalScores.values());
    const ranked = loaded.value.map(record => {
      const lexicalScore = (lexicalScores.get(record.id) ?? 0) / lexicalMax;
      const semanticScore = semanticScores.get(record.id) ?? 0;
      const score = lexicalScore * (1 - this.semanticWeight) + semanticScore * this.semanticWeight;
      return { record, score, lexicalScore, semanticScore };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt);
    return ok(ranked.slice(0, limit));
  }
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  projectId: string;
  text: string;
  sourceLabel: string;
  page?: number;
  section?: string;
}
export interface KnowledgeRepository {
  add(chunks: KnowledgeChunk[]): Promise<Result<void>>;
  replaceDocument?(documentId: string, projectId: string, chunks: KnowledgeChunk[]): Promise<Result<void>>;
  getByIds?(ids: string[]): Promise<Result<KnowledgeChunk[]>>;
  search(query: string, projectId: string, limit: number): Promise<Result<KnowledgeChunk[]>>;
  removeDocument(documentId: string, projectId: string): Promise<Result<void>>;
}
export interface KnowledgeVectorIndex {
  upsert(chunk: KnowledgeChunk, vector: number[]): Promise<void>;
  removeDocument(documentId: string, projectId: string): Promise<void>;
  search(vector: number[], projectId: string, limit: number): Promise<Array<{ id: string; score: number }>>;
}
export interface KnowledgeCitation { documentId: string; sourceLabel: string; page?: number; section?: string; chunkId: string; }
export interface RetrievedKnowledge { context: string; citations: KnowledgeCitation[]; }
/** RAG context builder returns explicit provenance; it never treats retrieved text as instructions. */
export class KnowledgeRetrievalService {
  constructor(private readonly repository: KnowledgeRepository, private readonly embeddings?: EmbeddingProvider, private readonly vectors?: KnowledgeVectorIndex) {}
  async retrieve(query: string, projectId: string, limit = 8): Promise<Result<RetrievedKnowledge>> {
    if (!query.trim() || !projectId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 20) return err("validation", "Knowledge query, project, or limit is invalid.");
    const found = await this.repository.search(query, projectId, Math.min(100, limit * 4));
    if (!found.ok) return found;
    let selected = found.value.slice(0, limit);
    if (this.embeddings && this.vectors && this.repository.getByIds) {
      try {
        const embedded = await this.embeddings.embed([query]);
        if (embedded.ok && embedded.value[0]?.length) {
          const semantic = await this.vectors.search(embedded.value[0], projectId, Math.min(100, limit * 4));
          const lexicalScores = new Map(found.value.map((chunk, index) => [chunk.id, 1 / (index + 1)]));
          const semanticScores = new Map(semantic.map(item => [item.id, Math.max(0, Math.min(1, item.score))]));
          const ids = [...new Set([...lexicalScores.keys(), ...semanticScores.keys()])];
          const loaded = await this.repository.getByIds(ids);
          if (loaded.ok) {
            const chunks = loaded.value.filter(chunk => chunk.projectId === projectId);
            const lexicalMax = Math.max(1, ...lexicalScores.values());
            selected = chunks.map(chunk => ({ chunk, score: 0.4 * ((lexicalScores.get(chunk.id) ?? 0) / lexicalMax) + 0.6 * (semanticScores.get(chunk.id) ?? 0) }))
              .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.chunk);
          }
        }
      } catch { /* Lexical retrieval remains available if the local model or index is unavailable. */ }
    }
    return ok({
      context: selected.map((chunk, index) => `[Source ${index + 1}: ${chunk.sourceLabel}${chunk.page ? `, page ${chunk.page}` : ""}]
${chunk.text}`).join("\n\n"),
      citations: selected.map(chunk => ({ documentId: chunk.documentId, sourceLabel: chunk.sourceLabel, page: chunk.page, section: chunk.section, chunkId: chunk.id }))
    });
  }
}
