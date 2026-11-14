import { describe, expect, it, vi } from "vitest";
import { runDatasetEvaluation } from "./datasetEvaluationRunner";
import type { DatasetSample } from "../core/trainingLab";

const samples = (ids: string[]): DatasetSample[] => ids.map((id, index) => ({
  id, split: "test", input: `input-${index}`, expectedOutput: `expected-${index}`
}));

describe("runDatasetEvaluation", () => {
  it("limits concurrency while preserving every successful result", async () => {
    let active = 0;
    let maximum = 0;
    const result = await runDatasetEvaluation(samples(["a", "b", "c", "d", "e"]), async sample => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return sample.input.toUpperCase();
    }, { concurrency: 2 });
    expect(maximum).toBe(2);
    expect(result.completed).toBe(5);
    expect(result.failures).toEqual([]);
    expect(Object.keys(result.outputs)).toHaveLength(5);
    expect(result.outputs.e.response).toBe("INPUT-4");
  });

  it("isolates provider failures and continues the remaining suite", async () => {
    const result = await runDatasetEvaluation(samples(["good", "bad", "also-good"]), async sample => {
      if (sample.id === "bad") throw new Error("temporary provider failure");
      return sample.input;
    });
    expect(result.completed).toBe(3);
    expect(result.failures).toEqual([{ sampleId: "bad", message: "temporary provider failure" }]);
    expect(Object.keys(result.outputs)).toEqual(expect.arrayContaining(["good", "also-good"]));
  });

  it("safely stores reserved object property names as sample IDs", async () => {
    const result = await runDatasetEvaluation(samples(["__proto__", "constructor", "toString"]), async sample => sample.input);
    expect(Object.keys(result.outputs)).toEqual(["__proto__", "constructor", "toString"]);
    expect(result.outputs["__proto__"].response).toBe("input-0");
  });

  it("reports progress once for every completed request", async () => {
    const progress = vi.fn();
    const result = await runDatasetEvaluation(samples(["a", "b", "c"]), async sample => sample.input, { onProgress: progress });
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect(progress).toHaveBeenCalledTimes(3);
    expect(result.total).toBe(3);
  });

  it("rejects invalid concurrency, duplicate IDs, and oversized evaluations", async () => {
    await expect(runDatasetEvaluation(samples(["a"]), async () => "ok", { concurrency: 5 })).rejects.toThrow(/concurrency/);
    await expect(runDatasetEvaluation(samples(["a", "a"]), async () => "ok")).rejects.toThrow(/duplicate/);
    await expect(runDatasetEvaluation(samples(Array.from({ length: 1_001 }, (_, i) => String(i))), async () => "ok")).rejects.toThrow(/1,000/);
  });

  it("stops scheduling after cancellation and reports cancellation", async () => {
    const controller = new AbortController();
    const execute = vi.fn(async () => {
      controller.abort();
      return "late";
    });
    await expect(runDatasetEvaluation(samples(["a", "b"]), execute, { signal: controller.signal, concurrency: 1 }))
      .rejects.toThrow(/cancelled/);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
