import { describe, expect, it } from "vitest";
import { runDatasetModelComparison, validateComparisonModelSelection } from "./datasetModelComparison";
import type { DatasetSample } from "../core/trainingLab";

const dataset: DatasetSample[] = [
  { id: "test-a", split: "test", input: "2 + 2", expectedOutput: "4" },
  { id: "test-b", split: "test", input: "capital of France", expectedOutput: "Paris" }
];

describe("runDatasetModelComparison", () => {
  it("validates discovered model IDs without silently deduplicating input", () => {
    expect(validateComparisonModelSelection(["model-a", "model-b"], ["model-a", "model-b"])).toBeNull();
    expect(validateComparisonModelSelection(["model-a", "model-a"], ["model-a", "model-b"])).toMatch(/distinct/);
    expect(validateComparisonModelSelection(["model-a", "missing"], ["model-a", "model-b"])).toMatch(/discovered/);
    expect(validateComparisonModelSelection(["model-a"], ["model-a"])).toMatch(/two and four/);
    expect(validateComparisonModelSelection(["x".repeat(161), "model-b"], ["x".repeat(161), "model-b"])).toMatch(/160 characters/);
  });

  it("compares all models on the same held-out cases and scores independently", async () => {
    const result = await runDatasetModelComparison(["model-a", "model-b"], dataset, async (model, sample) => {
      if (model === "model-a") return sample.id === "test-a" ? "4" : "Paris";
      return sample.id === "test-a" ? "four" : "London";
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ model: "model-a", status: "fulfilled", summary: { totalCases: 2, exactMatches: 2, exactMatchRate: 1 } });
    expect(result[1]).toMatchObject({ model: "model-b", status: "fulfilled", summary: { totalCases: 2, exactMatches: 0, exactMatchRate: 0 } });
  });

  it("isolates one model failure without discarding other model results", async () => {
    const result = await runDatasetModelComparison(["working", "broken"], dataset, async model => {
      if (model === "broken") throw new Error("provider unavailable");
      return "answer";
    });
    expect(result[0].status).toBe("fulfilled");
    expect(result[1]).toMatchObject({ model: "broken", status: "rejected", error: "provider unavailable" });
  });

  it("rejects training samples and duplicate model IDs", async () => {
    await expect(runDatasetModelComparison(["same", "same"], dataset, async () => "x")).rejects.toThrow(/distinct/);
    await expect(runDatasetModelComparison(["a", "b"], [{ ...dataset[0], split: "train" }], async () => "x")).rejects.toThrow(/held-out/);
  });

  it("propagates cancellation instead of reporting cancelled work as a model failure", async () => {
    const controller = new AbortController();
    const execute = async () => { controller.abort(); return "late"; };
    await expect(runDatasetModelComparison(["a", "b"], dataset, execute, { signal: controller.signal })).rejects.toThrow(/cancelled/);
  });
});
