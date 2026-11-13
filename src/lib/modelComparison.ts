export type ModelComparisonOutcome<T> =
  | { model: string; status: "fulfilled"; value: T }
  | { model: string; status: "rejected"; error: string };

/**
 * Runs independent model evaluations concurrently. A single provider failure
 * is captured per model so it cannot erase successful results from the others.
 * Cancellation remains global and is propagated to the caller.
 */
export async function runModelComparison<T>(
  models: string[],
  execute: (model: string) => Promise<T>,
  isCancelled: () => boolean = () => false
): Promise<ModelComparisonOutcome<T>[]> {
  return Promise.all(models.map(async model => {
    try {
      return { model, status: "fulfilled" as const, value: await execute(model) };
    } catch (cause) {
      if (isCancelled()) throw cause;
      return {
        model,
        status: "rejected" as const,
        error: cause instanceof Error ? cause.message : "Model request failed."
      };
    }
  }));
}
