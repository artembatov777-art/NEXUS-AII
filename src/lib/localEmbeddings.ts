import { err, ok, type Result } from "../core/result";
import type { EmbeddingProvider } from "../core/knowledge";
import { LOCAL_EMBEDDING_MODEL_ID } from "./knowledgeVectorIndex";

type TensorOutput = { tolist(): unknown };
type Extractor = (texts: string[], options: { pooling: "mean"; normalize: true }) => Promise<TensorOutput>;
type ExtractorFactory = () => Promise<Extractor>;

/** Runs a small sentence-transformer locally in the browser; model weights are downloaded on first use. */
export class LocalTransformerEmbeddingProvider implements EmbeddingProvider {
  private extractor?: Promise<Extractor>;

  constructor(private readonly createExtractor: ExtractorFactory = loadLocalExtractor) {}

  async embed(texts: string[], signal?: AbortSignal): Promise<Result<number[][]>> {
    if (!texts.length || texts.length > 500 || texts.some(text => !text.trim() || text.length > 12_000)) {
      return err("validation", "Embedding input is empty or exceeds local model limits.");
    }
    if (signal?.aborted) return err("cancelled", "Embedding was cancelled.");
    try {
      const extractor = await (this.extractor ??= this.createExtractor());
      if (signal?.aborted) return err("cancelled", "Embedding was cancelled.");
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      if (signal?.aborted) return err("cancelled", "Embedding was cancelled.");
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
}

async function loadLocalExtractor(): Promise<Extractor> {
  // Keep the large transformer runtime out of the initial workspace bundle.
  // It is downloaded only when semantic embeddings are actually requested.
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  const createPipeline = pipeline as unknown as (
    task: "feature-extraction",
    model: string,
    options: { dtype: "q8" }
  ) => Promise<Extractor>;
  return createPipeline("feature-extraction", LOCAL_EMBEDDING_MODEL_ID, { dtype: "q8" });
}
