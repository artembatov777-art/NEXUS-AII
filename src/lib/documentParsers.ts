 
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
  if (/\\.(txt|md|mdx|csv|json|jsonl|ndjson|log|yaml|yml|xml|ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|cs|rb|php|sh|ps1|sql|toml|ini|conf|properties)$/.test(name)) {
    const raw = await file.text();
    if (raw.length > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted text exceeds the 1 MB limit.");
    let content = raw;
    if (name.endsWith(".json")) {
      try { content = JSON.stringify(JSON.parse(raw), null, 2); }
      catch { throw new Error("The selected JSON file is not valid JSON."); }
    } else if (name.endsWith(".jsonl") || name.endsWith(".ndjson")) {
      try {
        content = raw.split(/\\r?\\n/).filter(line => line.trim()).map(line => JSON.stringify(JSON.parse(line))).join("\\n");
      } catch {
        throw new Error("The selected JSONL file contains an invalid JSON record.");
      }
    }
    if (content.length > MAX_EXTRACTED_CHARACTERS) throw new Error("Normalized document text exceeds the 1 MB limit.");
    return { mediaType: name.endsWith(".md") ? "text/markdown" : "text/plain", content };
  }
  if (name.endsWith(".pdf")) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useWorkerFetch: false }).promise;
    const pages: Array<{ text: string; page: number; section: string }> = [];
    let total = 0;
    try {
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
        total += text.length;
        if (total > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted PDF text exceeds the 1 MB limit.");
        if (text) pages.push({ text, page: pageNumber, section: `Page ${pageNumber}` });
      }
    } finally { await pdf.destroy(); }
    if (!pages.length) throw new Error("No selectable text was found in this PDF. Scanned-image OCR is not supported.");
    return { mediaType: "text/plain", content: pages.map(page => page.text).join("\n\n"), pages };
  }
  if (name.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer });
    if (result.value.length > MAX_EXTRACTED_CHARACTERS) throw new Error("Extracted DOCX text exceeds the 1 MB limit.");
    if (!result.value.trim()) throw new Error("No readable text was found in this DOCX file.");
    return { mediaType: "text/plain", content: result.value };
  }
  throw new Error("Unsupported file type. Choose TXT, Markdown, source code, CSV, JSON/JSONL, YAML, XML, PDF, or DOCX.");
}
