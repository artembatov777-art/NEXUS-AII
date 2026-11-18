import type { KnowledgeChunk, KnowledgeRepository } from "./knowledge";
import { err, ok, type Result } from "./result";

export type SupportedDocumentType = "text/plain" | "text/markdown";
export interface DocumentInput {
  id: string;
  projectId: string;
  fileName: string;
  mediaType: SupportedDocumentType;
  content: string;
  pages?: Array<{ text: string; page?: number; section?: string }>;
}
export interface IngestionSummary {
  documentId: string;
  projectId: string;
  fileName: string;
  chunkCount: number;
  characterCount: number;
  semanticIndexed: boolean;
}
export interface DocumentIngestionOptions {
  maxCharacters?: number;
  chunkCharacters?: number;
  overlapCharacters?: number;
  maxChunks?: number;
}
const DEFAULTS = { maxCharacters: 1_000_000, chunkCharacters: 4_000, overlapCharacters: 300, maxChunks: 500 };

function normalizeText(input: string): string {
  return input.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").replace(/[\t ]+\n/g, "\n").trim();
}

/** Splits text on paragraph boundaries where possible and adds bounded overlap for retrieval continuity. */
export function chunkDocumentText(text: string, chunkCharacters = DEFAULTS.chunkCharacters, overlapCharacters = DEFAULTS.overlapCharacters): string[] {
  if (!Number.isInteger(chunkCharacters) || chunkCharacters < 256 || chunkCharacters > 12_000) throw new Error("chunkCharacters must be between 256 and 12000");
  if (!Number.isInteger(overlapCharacters) || overlapCharacters < 0 || overlapCharacters >= chunkCharacters / 2) throw new Error("overlapCharacters must be less than half the chunk size");
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ""; };
  for (const paragraph of paragraphs) {
    let remaining = paragraph.trim();
    while (remaining.length > chunkCharacters) {
      const room = chunkCharacters - current.length - (current ? 2 : 0);
      if (room > 0) {
        current += (current ? "\n\n" : "") + remaining.slice(0, room);
        remaining = remaining.slice(room);
      }
      push();
      current = overlapCharacters ? (chunks[chunks.length - 1]?.slice(-overlapCharacters) ?? "") : "";
    }
    if (remaining) {
      const candidate = current ? current + "\n\n" + remaining : remaining;
      if (candidate.length > chunkCharacters) push();
      current = current ? current + "\n\n" + remaining : remaining;
    }
  }
  push();
  return chunks;
}

export class DocumentIngestionService {
  private readonly limits: typeof DEFAULTS;
  constructor(
    private readonly repository: KnowledgeRepository,
    options: DocumentIngestionOptions = {},
    private readonly embeddings?: import("./knowledge").EmbeddingProvider,
    private readonly vectors?: import("./knowledge").KnowledgeVectorIndex
  ) {
    this.limits = { ...DEFAULTS, ...options };
    if (!Number.isInteger(this.limits.maxCharacters) || this.limits.maxCharacters < 1 ||
        !Number.isInteger(this.limits.maxChunks) || this.limits.maxChunks < 1) {
      throw new Error("Document ingestion limits must be positive integers");
    }
  }

  async ingest(input: DocumentInput): Promise<Result<IngestionSummary>> {
    const fileName = input.fileName.trim();
    if (!input.id.trim() || !input.projectId.trim() || !fileName || fileName.length > 240) {
      return err("validation", "Document identity, project, and file name are required.");
    }
    if (input.mediaType !== "text/plain" && input.mediaType !== "text/markdown") {
      return err("validation", "Only plain-text and Markdown imports are supported by this parser.");
    }
    if (typeof input.content !== "string" || input.content.length > this.limits.maxCharacters) {
      return err("validation", "Document content is invalid or exceeds the import size limit.");
    }
    const normalized = normalizeText(input.content);
    if (!normalized) return err("validation", "The document contains no readable text.");
    const sourceSegments: Array<{ text: string; page?: number; section?: string }> = input.pages?.length ? input.pages.map((page, index) => ({ ...page, text: normalizeText(page.text), page: page.page ?? index + 1 })) : [{ text: normalized }];
    const prepared = sourceSegments.flatMap(segment => chunkDocumentText(segment.text, this.limits.chunkCharacters, this.limits.overlapCharacters).map((text, index) => ({ text, page: segment.page, section: segment.section ?? `Chunk ${index + 1}` })));
    if (!prepared.length || prepared.length > this.limits.maxChunks) {
      return err("validation", "Document creates too many chunks for a single import.");
    }
    const chunks: KnowledgeChunk[] = prepared.map((segment, index) => ({
      id: `${input.id}:chunk:${index + 1}`,
      documentId: input.id,
      projectId: input.projectId,
      text: segment.text,
      sourceLabel: fileName,
      ...(segment.page !== undefined ? { page: segment.page } : {}),
      section: segment.section
    }));
    const saved = this.repository.replaceDocument
      ? await this.repository.replaceDocument(input.id, input.projectId, chunks)
      : await this.repository.add(chunks);
    if (!saved.ok) return saved;
    let semanticIndexed = false;
    if (this.embeddings && this.vectors) {
      try {
        await this.vectors.removeDocument(input.id, input.projectId);
        const embedded = await this.embeddings.embed(chunks.map(chunk => chunk.text));
        if (embedded.ok && embedded.value.length === chunks.length) {
          await Promise.all(chunks.map((chunk, index) => this.vectors!.upsert(chunk, embedded.value[index])));
          semanticIndexed = true;
        }
      } catch {
        try { await this.vectors.removeDocument(input.id, input.projectId); } catch { /* Lexical index remains authoritative. */ }
      }
    }
    return ok({ documentId: input.id, projectId: input.projectId, fileName, chunkCount: chunks.length, characterCount: normalized.length, semanticIndexed });
  }

  /** Repairs missing/stale vectors from the authoritative project document store. Safe to retry after partial failure. */
  async rebuildSemanticIndex(projectId: string): Promise<Result<{ indexed: number; totalChunks: number }>> {
    if (!projectId.trim()) return err("validation", "A project ID is required to rebuild its semantic index.");
    if (!this.embeddings || !this.vectors?.reconcile || !this.repository.exportAll) {
      return err("provider_unavailable", "Semantic index repair requires an embedding provider, vector reconciliation, and document export.");
    }
    const exported = await this.repository.exportAll();
    if (!exported.ok) return exported;
    const projectChunks = exported.value.filter(chunk => chunk.projectId === projectId);
    let missing: KnowledgeChunk[];
    try {
      missing = await this.vectors.reconcile(projectChunks);
    } catch {
      return err("storage_failed", "Could not inspect or repair the project's vector index.", true);
    }
    let indexed = 0;
    for (let offset = 0; offset < missing.length; offset += 32) {
      const batch = missing.slice(offset, offset + 32);
      const embedded = await this.embeddings.embed(batch.map(chunk => chunk.text));
      if (!embedded.ok) return embedded;
      if (embedded.value.length !== batch.length || embedded.value.some(vector =>
        !vector.length || vector.some(value => !Number.isFinite(value))
      )) {
        return err("validation", "The embedding provider returned an invalid batch while rebuilding the semantic index.");
      }
      try {
        await Promise.all(batch.map((chunk, index) => this.vectors!.upsert(chunk, embedded.value[index])));
      } catch {
        return err("storage_failed", "The semantic index could not store a rebuilt batch. Run repair again to continue safely.", true);
      }
      indexed += batch.length;
    }
    return ok({ indexed, totalChunks: projectChunks.length });
  }

  async remove(documentId: string, projectId: string): Promise<Result<void>> {
    if (!documentId.trim() || !projectId.trim()) return err("validation", "Document and project identifiers are required.");
    const removed = await this.repository.removeDocument(documentId, projectId);
    if (removed.ok && this.vectors) {
      try { await this.vectors.removeDocument(documentId, projectId); } catch { /* Removed chunks cannot be returned by repository lookup. */ }
    }
    return removed;
  }
}
