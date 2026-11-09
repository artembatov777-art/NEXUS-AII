import { env, pipeline } from "@xenova/transformers";
import { err, ok, type Result } from "../core/result";
import type { EmbeddingProvider } from "../core/knowledge";

type TensorOutput = { tolist(): unknown };
type Extractor = (texts: string[], options: { pooling: "mean"; normalize: true }) => Promise<TensorOutput>;
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** Runs a small sentence-transformer locally in the browser; model weights are downloaded on first use. */
export class LocalTransformerEmbeddingProvider implements EmbeddingProvider {
  private extractor?: Promise<Extractor>;

  async embed(texts: string[], signal?: AbortSignal): Promise<Result<number[][]>> {
    if (!texts.length || texts.length > 500 || texts.some(text => !text.trim() || text.length > 12_000)) {
      return err("validation", "Embedding input is empty or exceeds local model limits.");
    }
    if (signal?.aborted) return err("cancelled", "Embedding was cancelled.");
    try {
      const extractor = await (this.extractor ??= this.load());
      if (signal?.aborted) return err("cancelled", "Embedding was cancelled.");
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const raw = output.tolist();
      if (!Array.isArray(raw)) return err("validation", "Local embedding model returned an invalid tensor.");
      const vectors = (raw as unknown[]).map(row => Array.isArray(row) ? row.map(Number) : []);
      if (vectors.length !== texts.length || vectors.some(vector => !vector.length || vector.some(value => !Number.isFinite(value)))) {
        return err("validation", "Local embedding model returned invalid vectors.");
      }
      return ok(vectors);
    } catch (cause) {
      this.extractor = undefined;
      return err("provider_unavailable", cause instanceof Error ? cause.message : "Local embedding model could not be loaded.", true);
    }
  }

  private async load(): Promise<Extractor> {
    env.allowRemoteModels = true;
    env.allowLocalModels = true;
    const createPipeline = pipeline as unknown as (
      task: "feature-extraction",
      model: string,
      options: { quantized: boolean }
    ) => Promise<Extractor>;
    return createPipeline("feature-extraction", MODEL_ID, { quantized: true });
  }
}
