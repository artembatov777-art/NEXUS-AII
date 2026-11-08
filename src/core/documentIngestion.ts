import type { KnowledgeChunk, KnowledgeRepository } from "./knowledge";
import { err, ok, type Result } from "./result";

export type SupportedDocumentType = "text/plain" | "text/markdown";
export interface DocumentInput {
  id: string;
  projectId: string;
  fileName: string;
  mediaType: SupportedDocumentType;
  content: string;
}
export interface IngestionSummary {
  documentId: string;
  projectId: string;
  fileName: string;
  chunkCount: number;
  characterCount: number;
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
      const overlap = chunks[chunks.length - 1]?.slice(-overlapCharacters) ?? "";
      current = overlap;
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
  constructor(private readonly repository: KnowledgeRepository, options: DocumentIngestionOptions = {}) {
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
    const texts = chunkDocumentText(normalized, this.limits.chunkCharacters, this.limits.overlapCharacters);
    if (!texts.length || texts.length > this.limits.maxChunks) {
      return err("validation", "Document creates too many chunks for a single import.");
    }
    const chunks: KnowledgeChunk[] = texts.map((text, index) => ({
      id: `${input.id}:chunk:${index + 1}`,
      documentId: input.id,
      projectId: input.projectId,
      text,
      sourceLabel: fileName,
      section: `Chunk ${index + 1}`
    }));
    const saved = await this.repository.add(chunks);
    if (!saved.ok) return saved;
    return ok({ documentId: input.id, projectId: input.projectId, fileName, chunkCount: chunks.length, characterCount: normalized.length });
  }

  async remove(documentId: string, projectId: string): Promise<Result<void>> {
    if (!documentId.trim() || !projectId.trim()) return err("validation", "Document and project identifiers are required.");
    return this.repository.removeDocument(documentId, projectId);
  }
}
