import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "./knowledgeVectorIndex";

describe("knowledge vector index similarity", () => {
  it("scores identical normalized vectors at one", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });
  it("returns zero for orthogonal or invalid dimensions", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [1])).toBe(0);
  });
  it("clamps negative similarity to zero", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });
});
