import { describe, expect, it } from "vitest";
import { parseKnowledgeFile } from "./documentParsers";

describe("knowledge document parsers", () => {
  it("extracts UTF-8 text and markdown without altering content", async () => {
    const file = new File(["# Heading\n\nUseful text"], "notes.md", { type: "text/markdown" });
    await expect(parseKnowledgeFile(file)).resolves.toEqual({
      mediaType: "text/markdown",
      content: "# Heading\n\nUseful text"
    });
  });

  it("rejects unsupported extensions and oversized files", async () => {
    const unsupported = new File(["data"], "archive.zip");
    await expect(parseKnowledgeFile(unsupported)).rejects.toThrow("Unsupported file type");
    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.txt");
    await expect(parseKnowledgeFile(oversized)).rejects.toThrow("larger than 8 MB");
  });
});
