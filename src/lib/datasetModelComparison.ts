import type { DatasetSample, DatasetEvaluationSummary } from "../core/trainingLab";
import { scoreDatasetEvaluation } from "../core/trainingLab";
import { runDatasetEvaluation, type DatasetEvaluationFailure } from "./datasetEvaluationRunner";

/** Rejects duplicate, malformed, or undiscovered model IDs before any provider request is sent. */
export function validateComparisonModelSelection(models: string[], availableModels: string[]): string | null {
  if (!Array.isArray(models) || models.length < 2 || models.length > 4) {
    return "Enter between two and four model IDs before comparing.";
  }
  const normalized = models.map(model => typeof model === "string" ? model.trim() : "");
  if (normalized.some(model => !model || model.length > 160) || new Set(normalized).size !== normalized.length) {
    return "Model IDs must be valid, distinct values no longer than 160 characters.";
  }
  const available = new Set(availableModels);
  const missing = normalized.filter(model => !available.has(model));
  return missing.length ? "Use only models discovered from the current provider. Not found: " + missing.join(", ") : null;
}

export type DatasetModelComparisonOutcome =
  | { model: string; status: "fulfilled"; summary: DatasetEvaluationSummary; failures: DatasetEvaluationFailure[] }
  | { model: string; status: "rejected"; error: string };

export interface DatasetModelComparisonOptions {
  signal?: AbortSignal;
  onProgress?: (model: string, completed: number, total: number) => void;
}

/** Runs the same held-out samples against 2-4 models; expected answers never leave the app. */
export async function runDatasetModelComparison(
  models: string[],
  samples: DatasetSample[],
  execute: (model: string, sample: DatasetSample, signal: AbortSignal | undefined) => Promise<string>,
  options: DatasetModelComparisonOptions = {}
): Promise<DatasetModelComparisonOutcome[]> {
  const uniqueModels = [...new Set(models)];
  if (models.length < 2 || models.length > 4 || uniqueModels.length !== models.length ||
      uniqueModels.some(model => !model.trim() || model.length > 160)) {
    throw new Error("Dataset model comparison requires 2 to 4 distinct valid model IDs.");
  }
  if (samples.length === 0 || samples.length > 1_000 || samples.some(sample => sample.split !== "test")) {
    throw new Error("Dataset model comparison accepts only 1 to 1,000 held-out test samples.");
  }
  if (options.signal?.aborted) throw new Error("Dataset model comparison was cancelled.");

  const results = await Promise.all(uniqueModels.map(async model => {
    try {
      const evaluation = await runDatasetEvaluation(
        samples,
        (sample, signal) => execute(model, sample, signal),
        {
          signal: options.signal,
          concurrency: 1,
          onProgress: (completed, total) => options.onProgress?.(model, completed, total)
        }
      );
      const summary = scoreDatasetEvaluation(samples, evaluation.outputs);
      if (summary.completedCases === 0 && evaluation.failures.length > 0) {
        return { model, status: "rejected" as const, error: evaluation.failures[0].message };
      }
      return {
        model,
        status: "fulfilled" as const,
        summary,
        failures: evaluation.failures
      };
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      return {
        model,
        status: "rejected" as const,
        error: cause instanceof Error ? cause.message : "Dataset model comparison failed."
      };
    }
  }));
  if (options.signal?.aborted) throw new Error("Dataset model comparison was cancelled.");
  return results;
}
