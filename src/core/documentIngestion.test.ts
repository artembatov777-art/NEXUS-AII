import { describe, expect, it, vi } from "vitest";
import { DocumentIngestionService, chunkDocumentText } from "./documentIngestion";
import type { KnowledgeChunk, KnowledgeRepository } from "./knowledge";
import { ok } from "./result";

function repository() {
  const chunks: KnowledgeChunk[] = [];
  const repo: KnowledgeRepository = {
    add: async values => { chunks.push(...values); return ok(undefined); },
    search: async () => ok(chunks),
    removeDocument: async id => { for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].documentId === id) chunks.splice(i, 1); return ok(undefined); }
  };
  return { repo, chunks };
}

describe("document ingestion", () => {
  it("chunks text with stable document provenance", async () => {
    const { repo, chunks } = repository();
    const service = new DocumentIngestionService(repo, { chunkCharacters: 300, overlapCharacters: 30 });
    const content = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${"architecture ".repeat(8)}`).join("\n\n");
    const result = await service.ingest({ id: "doc-1", projectId: "project-1", fileName: "notes.md", mediaType: "text/markdown", content });
    expect(result.ok).toBe(true);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.projectId === "project-1" && chunk.sourceLabel === "notes.md")).toBe(true);
    expect(chunks[0].id).toBe("doc-1:chunk:1");
  });

  it("rejects unsupported formats and oversized inputs before persistence", async () => {
    const { repo, chunks } = repository();
    const add = vi.spyOn(repo, "add");
    const service = new DocumentIngestionService(repo, { maxCharacters: 10 });
    const unsupported = await service.ingest({ id: "d", projectId: "p", fileName: "x.pdf", mediaType: "application/pdf" as "text/plain", content: "text" });
    const oversized = await service.ingest({ id: "d2", projectId: "p", fileName: "x.txt", mediaType: "text/plain", content: "12345678901" });
    expect(unsupported.ok).toBe(false);
    expect(oversized.ok).toBe(false);
    expect(add).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(0);
  });

  it("supports zero overlap without looping", () => {
    const chunks = chunkDocumentText("a".repeat(700), 300, 0);
    expect(chunks.length).toBe(3);
    expect(chunks.every(chunk => chunk.length <= 300)).toBe(true);
  });

  it("returns no chunks for empty input and validates chunk limits", () => {
    expect(chunkDocumentText(" \n\n ")).toEqual([]);
    expect(() => chunkDocumentText("text", 100, 10)).toThrow();
  });
});
