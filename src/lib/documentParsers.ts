import * as mammoth from "mammoth";
import { getDocument } from "pdfjs-dist";

export type ParsedKnowledgeFile = {
  mediaType: "text/plain" | "text/markdown";
  content: string;
  pages?: Array<{ text: string; page: number; section: string }>;
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 1_000_000;

export async function parseKnowledgeFile(file: File): Promise<ParsedKnowledgeFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Files larger than 8 MB are not supported.");
  const name = file.name.toLocaleLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    const content = await file.text();
    if (content.length > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted text exceeds the 1 MB limit.");
    return { mediaType: name.endsWith(".md") ? "text/markdown" : "text/plain", content };
  }
  if (name.endsWith(".pdf")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false }).promise;
    const pages: Array<{ text: string; page: number; section: string }> = [];
    let total = 0;
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\\s+/g, " ").trim();
        total += text.length;
        if (total > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted PDF text exceeds the 1 MB limit.");
        if (text) pages.push({ text, page: pageNumber, section: `Page ${pageNumber}` });
      }
    } finally { await pdf.destroy(); }
    if (!pages.length) throw new Error("No selectable text was found in this PDF. Scanned-image OCR is not supported.");
    return { mediaType: "text/plain", content: pages.map(page => page.text).join("\\n\\n"), pages };
  }
  if (name.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    if (result.value.length > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted DOCX text exceeds the 1 MB limit.");
    if (!result.value.trim()) throw new Error("No readable text was found in this DOCX file.");
    return { mediaType: "text/plain", content: result.value };
  }
  throw new Error("Unsupported file type. Choose TXT, Markdown, PDF, or DOCX.");
}
