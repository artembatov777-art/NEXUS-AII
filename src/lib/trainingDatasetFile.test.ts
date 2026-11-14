import { describe, expect, it } from "vitest";
import { formatTrainingDatasetSplitIds, parseTrainingDatasetFile, serializeTrainingDatasetSamples } from "./trainingDatasetFile";

const rows = [
  { id: "a", split: "train", input: "prompt", expectedOutput: "answer" },
  { id: "b", split: "validation", input: "prompt", expectedOutput: "answer" },
  { id: "c", split: "test", input: "prompt", expectedOutput: "answer" }
];

describe("training dataset file format", () => {
  it("imports JSONL samples and round-trips them", () => {
    const samples = parseTrainingDatasetFile(rows.map(row => JSON.stringify(row)).join("\n"));
    expect(samples).toEqual(rows);
    expect(parseTrainingDatasetFile(serializeTrainingDatasetSamples(samples))).toEqual(samples);
  });

  it("normalizes surrounding whitespace in sample IDs before split matching", () => {
    const input = rows.map(row => JSON.stringify({ ...row, id: ` ${row.id} ` })).join("\n");
    expect(parseTrainingDatasetFile(input).map(sample => sample.id)).toEqual(["a", "b", "c"]);
  });

  it("formats imported split IDs as real editor lines", () => {
    const samples = parseTrainingDatasetFile(rows.map(row => JSON.stringify(row)).join("\n"));
    expect(formatTrainingDatasetSplitIds(samples, "train")).toBe("a");
    expect(formatTrainingDatasetSplitIds(samples, "validation")).toBe("b");
    expect(formatTrainingDatasetSplitIds(samples, "test")).toBe("c");
    expect(formatTrainingDatasetSplitIds([
      { ...samples[0], id: "first" },
      { ...samples[0], id: "second" }
    ], "train")).toBe("first\nsecond");
  });

  it("rejects IDs that break the split editor's newline/comma format", () => {
    for (const id of ["two\nlines", "comma,id"]) {
      const data = rows.map((row, index) => JSON.stringify({ ...row, id: index === 0 ? id : row.id })).join("\n");
      expect(() => parseTrainingDatasetFile(data)).toThrow(/sample IDs/i);
    }
  });

  it("accepts a JSON array export", () => {
    expect(parseTrainingDatasetFile(JSON.stringify(rows))).toEqual(rows);
  });

  it("rejects duplicate IDs and missing split coverage", () => {
    expect(() => parseTrainingDatasetFile([...rows, rows[0]].map(row => JSON.stringify(row)).join("\n"))).toThrow(/duplicate/i);
    expect(() => parseTrainingDatasetFile(rows.slice(0, 2).map(row => JSON.stringify(row)).join("\n"))).toThrow(/at least one train/i);
  });

  it("rejects malformed rows and oversized content", () => {
    expect(() => parseTrainingDatasetFile('{"id":"x","input":"p"}')).toThrow(/requires id/i);
    expect(() => parseTrainingDatasetFile("x".repeat(1_000_001))).toThrow(/1 MB/i);
  });
});
