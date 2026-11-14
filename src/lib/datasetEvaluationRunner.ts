import type { DatasetSample } from "../core/trainingLab";

export interface DatasetEvaluationOutput {
  response: string;
  latencyMs: number;
}
export interface DatasetEvaluationFailure {
  sampleId: string;
  message: string;
}
export interface DatasetEvaluationRun {
  outputs: Record<string, DatasetEvaluationOutput>;
  failures: DatasetEvaluationFailure[];
  completed: number;
  total: number;
}
export interface DatasetEvaluationOptions {
  signal?: AbortSignal;
  concurrency?: number;
  now?: () => number;
  onProgress?: (completed: number, total: number) => void;
}

/** Executes a bounded held-out evaluation without allowing arbitrary sample IDs to corrupt results. */
export async function runDatasetEvaluation(
  samples: DatasetSample[],
  execute: (sample: DatasetSample, signal: AbortSignal | undefined) => Promise<string>,
  options: DatasetEvaluationOptions = {}
): Promise<DatasetEvaluationRun> {
  const concurrency = options.concurrency ?? 3;
  if (!Array.isArray(samples) || samples.length > 1_000 ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
      typeof execute !== "function") {
    throw new Error("Dataset evaluation requires at most 1,000 samples and concurrency from 1 to 4.");
  }
  if (options.signal?.aborted) throw new Error("Dataset evaluation was cancelled.");
  const ids = new Set<string>();
  for (const sample of samples) {
    if (!sample || typeof sample.id !== "string" || sample.id.trim() !== sample.id ||
        !sample.id || sample.id.length > 160 || ids.has(sample.id)) {
      throw new Error("Dataset evaluation contains an invalid or duplicate sample ID.");
    }
    if (sample.split !== "test" || typeof sample.input !== "string" ||
        !sample.input.trim() || sample.input.length > 12_000) {
      throw new Error("Only valid held-out test samples may be sent to a provider.");
    }
    ids.add(sample.id);
  }

  const outputs = Object.create(null) as Record<string, DatasetEvaluationOutput>;
  const failuresByIndex: Array<DatasetEvaluationFailure | undefined> = new Array(samples.length);
  const now = options.now ?? (() => performance.now());
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (true) {
      if (options.signal?.aborted) return;
      const index = cursor++;
      if (index >= samples.length) return;
      const sample = samples[index];
      const startedAt = now();
      try {
        const response = await execute(sample, options.signal);
        if (options.signal?.aborted) return;
        if (typeof response !== "string") throw new Error("Provider returned a non-text response.");
        outputs[sample.id] = { response, latencyMs: Math.max(0, now() - startedAt) };
      } catch (cause) {
        if (options.signal?.aborted) return;
        failuresByIndex[index] = {
          sampleId: sample.id,
          message: cause instanceof Error ? cause.message.slice(0, 500) : "Provider request failed."
        };
      } finally {
        completed += 1;
        options.onProgress?.(completed, samples.length);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, samples.length) }, () => worker()));
  if (options.signal?.aborted) throw new Error("Dataset evaluation was cancelled.");
  return { outputs, failures: failuresByIndex.filter((item): item is DatasetEvaluationFailure => item !== undefined), completed, total: samples.length };
}
