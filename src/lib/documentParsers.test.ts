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


  it("imports CSV, YAML, XML, logs, source code, and configuration as bounded text", async () => {
    const fixtures = [
      ["table.csv", "name,value\nalpha,1"],
      ["config.yaml", "service:\n  enabled: true"],
      ["feed.xml", "<root><item>hello</item></root>"],
      ["app.log", "INFO startup complete"],
      ["answer.ts", "export const answer = 42;"],
      ["Cargo.toml", "[workspace]\nname = \"nexus\""]
    ];
    for (const [name, content] of fixtures) {
      const parsed = await parseKnowledgeFile(new File([content], name));
      expect(parsed.mediaType).toBe("text/plain");
      expect(parsed.content).toContain(content.split("\n")[0]);
    }
  });

  it("normalizes valid JSON and JSONL and rejects malformed records", async () => {
    const json = await parseKnowledgeFile(new File(['{"enabled":true,"count":2}'], "config.json"));
    expect(json.content).toContain('"enabled": true');
    const jsonl = await parseKnowledgeFile(new File(['{"id":1}\n{"id":2}'], "records.jsonl"));
    expect(jsonl.content).toBe('{"id":1}\n{"id":2}');
    await expect(parseKnowledgeFile(new File(['{"broken":'], "broken.json"))).rejects.toThrow(/valid JSON/);
    await expect(parseKnowledgeFile(new File(['{"ok":1}\nnot-json'], "broken.jsonl"))).rejects.toThrow(/invalid JSON record/);
  });

  it("rejects unsupported extensions and oversized files", async () => {
    const unsupported = new File(["data"], "archive.zip");
    await expect(parseKnowledgeFile(unsupported)).rejects.toThrow("Unsupported file type");
    const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.txt");
    await expect(parseKnowledgeFile(oversized)).rejects.toThrow("larger than 8 MB");
  });
});
