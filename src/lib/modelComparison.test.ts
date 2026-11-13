import { describe, expect, it, vi } from "vitest";
import { runModelComparison } from "./modelComparison";

describe("runModelComparison", () => {
  it("preserves successful results when one provider fails", async () => {
    const execute = vi.fn(async (model: string) => {
      if (model === "unavailable") throw new Error("Provider unavailable");
      return `response from ${model}`;
    });
    const results = await runModelComparison(["model-a", "unavailable", "model-b"], execute);
    expect(results).toEqual([
      { model: "model-a", status: "fulfilled", value: "response from model-a" },
      { model: "unavailable", status: "rejected", error: "Provider unavailable" },
      { model: "model-b", status: "fulfilled", value: "response from model-b" }
    ]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("propagates global cancellation instead of recording it as a provider failure", async () => {
    const cancellation = new Error("cancelled");
    await expect(runModelComparison(["model-a", "model-b"], async model => {
      if (model === "model-a") throw cancellation;
      return model;
    }, () => true)).rejects.toBe(cancellation);
  });

  it("keeps output order aligned with the requested model order", async () => {
    const results = await runModelComparison(["slow", "fast"], async model => {
      await new Promise(resolve => setTimeout(resolve, model === "slow" ? 5 : 0));
      return model;
    });
    expect(results.map(result => result.model)).toEqual(["slow", "fast"]);
  });
});
