import type { ModelDescriptor } from "./domain";
import { err, ok, type Result } from "./result";

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; finishReason?: string };

export interface ModelProvider {
  readonly id: string;
  listModels(): Promise<Result<ModelDescriptor[]>>;
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}

const MAX_MODEL_ID_LENGTH = 128;
const MAX_MESSAGES = 100;
const MAX_MESSAGE_BYTES = 100_000;
const MAX_REQUEST_BYTES = 1_000_000;

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export interface ProviderCatalogFailure {
  providerId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export class ModelRouter {
  private readonly providers = new Map<string, ModelProvider>();
  private catalogFailures: ProviderCatalogFailure[] = [];

  getProviderFailures(): ProviderCatalogFailure[] {
    return this.catalogFailures.map(failure => ({ ...failure }));
  }

  register(provider: ModelProvider): Result<void> {
    if (!provider.id.trim() || provider.id.length > 128 || /[\u0000-\u001f\u007f]/.test(provider.id)) {
      return err("validation", "Provider ID must be a non-empty string of at most 128 characters without control characters.");
    }
    if (this.providers.has(provider.id)) {
      return err("validation", `Provider "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
    return ok(undefined);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
    this.catalogFailures = this.catalogFailures.filter(failure => failure.providerId !== providerId);
  }

  getProvider(providerId: string): Result<ModelProvider> {
    const provider = this.providers.get(providerId);
    if (!provider) return err("provider_unavailable", `Provider "${providerId}" is not registered.`, true);
    return ok(provider);
  }

  async listModels(): Promise<Result<ModelDescriptor[]>> {
    const providers = [...this.providers.values()];
    const results = await Promise.all(providers.map(async provider => ({
      providerId: provider.id,
      result: await provider.listModels().catch(cause => err(
        "provider_unavailable",
        cause instanceof Error ? cause.message : "Provider model discovery failed.",
        true
      ))
    })));
    this.catalogFailures = results.flatMap(({ providerId, result }) => result.ok ? [] : [{
      providerId,
      code: result.error.code,
      message: result.error.message,
      retryable: result.error.retryable
    }]);
    const available = results.flatMap(({ result }) => result.ok ? result.value : []);
    if (available.length > 0 || this.catalogFailures.length === 0) return ok(available);
    const firstFailure = results.find(entry => !entry.result.ok)?.result;
    return firstFailure && !firstFailure.ok ? firstFailure : ok([]);
  }

  async *stream(providerId: string, request: ModelRequest): AsyncIterable<ModelEvent> {
    const resolved = this.getProvider(providerId);
    if (!resolved.ok) throw new Error(resolved.error.message);
    if (!request.model.trim() || utf8Length(request.model) > MAX_MODEL_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(request.model)) {
      throw new Error("Model ID must be a non-empty string of at most 128 UTF-8 bytes without control characters.");
    }
    if (request.messages.length === 0 || request.messages.length > MAX_MESSAGES) {
      throw new Error("A request must contain between 1 and 100 messages.");
    }
    let requestBytes = 0;
    for (const message of request.messages) {
      if (!["system", "user", "assistant", "tool"].includes(message.role) || typeof message.content !== "string") {
        throw new Error("Message role or content is invalid.");
      }
      const messageBytes = utf8Length(message.content);
      if (messageBytes > MAX_MESSAGE_BYTES) throw new Error("A message exceeds the 100 KB content limit.");
      requestBytes += messageBytes;
      if (requestBytes > MAX_REQUEST_BYTES) throw new Error("The request exceeds the 1 MB content limit.");
    }
    if (request.temperature !== undefined && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)) {
      throw new Error("Temperature must be a finite number between 0 and 2.");
    }
    if (request.maxOutputTokens !== undefined && (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 1_000_000)) {
      throw new Error("Maximum output tokens must be an integer between 1 and 1,000,000.");
    }
    if (request.signal?.aborted) throw new Error("Request cancelled.");
    yield* resolved.value.stream(request);
  }
}


export type ModelRegistryState = "unknown" | "ready" | "unavailable";

export interface ModelRegistrySnapshot {
  state: ModelRegistryState;
  checkedAt: number | null;
  modelCount: number;
  error?: string;
  failedProviders?: string[];
}

/**
 * Provider-neutral in-memory catalog and active-model selection.
 * Runtime availability is based only on a successful provider catalog refresh;
 * it does not claim that a remote model is currently healthy or reachable.
 */
export class ModelRegistry {
  private readonly catalog = new Map<string, ModelDescriptor>();
  private activeKey: string | null = null;
  private refreshGeneration = 0;
  private snapshot: ModelRegistrySnapshot = {
    state: "unknown",
    checkedAt: null,
    modelCount: 0
  };

  constructor(
    private readonly router: ModelRouter,
    private readonly now: () => number = () => Date.now()
  ) {}

  private key(providerId: string, modelId: string): string {
    return JSON.stringify([providerId, modelId]);
  }

  getSnapshot(): ModelRegistrySnapshot {
    return { ...this.snapshot };
  }

  listModels(): ModelDescriptor[] {
    return [...this.catalog.values()].map(model => ({
      ...model,
      ...(model.modalities ? { modalities: [...model.modalities] } : {})
    }));
  }

  async refresh(): Promise<Result<ModelDescriptor[]>> {
    const generation = ++this.refreshGeneration;
    const isCurrent = () => generation === this.refreshGeneration;
    const superseded = () => err("cancelled", "A newer model catalog refresh superseded this request.");
    try {
      const result = await this.router.listModels();
      if (!isCurrent()) return superseded();
      if (!result.ok) {
        this.snapshot = {
          state: "unavailable",
          checkedAt: this.now(),
          modelCount: this.catalog.size,
          error: result.error.message
        };
        return result;
      }

      const next = new Map<string, ModelDescriptor>();
      for (const model of result.value) {
        if (
          !model.id.trim() || utf8Length(model.id) > MAX_MODEL_ID_LENGTH ||
          /[\u0000-\u001f\u007f]/.test(model.id) ||
          !model.providerId.trim() || !model.displayName.trim()
        ) {
          this.snapshot = {
            state: "unavailable",
            checkedAt: this.now(),
            modelCount: this.catalog.size,
            error: "Provider returned a model with invalid identity metadata."
          };
          return err("validation", this.snapshot.error!);
        }
        const key = this.key(model.providerId, model.id);
        if (next.has(key)) {
          this.snapshot = {
            state: "unavailable",
            checkedAt: this.now(),
            modelCount: this.catalog.size,
            error: `Provider returned duplicate model identity "${model.providerId}/${model.id}".`
          };
          return err("validation", this.snapshot.error!);
        }
        next.set(key, {
          ...model,
          ...(model.modalities ? { modalities: [...model.modalities] } : {})
        });
      }

      this.catalog.clear();
      for (const [key, model] of next) this.catalog.set(key, model);
      if (this.activeKey && !this.catalog.has(this.activeKey)) this.activeKey = null;
      const failedProviders = this.router.getProviderFailures().map(failure => failure.providerId);
      this.snapshot = {
        state: "ready",
        checkedAt: this.now(),
        modelCount: this.catalog.size,
        ...(failedProviders.length ? { failedProviders } : {})
      };
      return ok(this.listModels());
    } catch (cause) {
      if (!isCurrent()) return superseded();
      const message = cause instanceof Error ? cause.message : "Model catalog refresh failed.";
      this.snapshot = {
        state: "unavailable",
        checkedAt: this.now(),
        modelCount: this.catalog.size,
        error: message
      };
      return err("provider_unavailable", message, true);
    }
  }

  setActiveModel(providerId: string, modelId: string): Result<ModelDescriptor> {
    if (this.snapshot.state !== "ready") {
      return err("provider_unavailable", "Refresh the model catalog before selecting an active model.", true);
    }
    const key = this.key(providerId, modelId);
    const model = this.catalog.get(key);
    if (!model) return err("validation", "The selected model is not present in the current model catalog.");
    this.activeKey = key;
    return ok({ ...model, ...(model.modalities ? { modalities: [...model.modalities] } : {}) });
  }

  getActiveModel(): Result<ModelDescriptor> {
    if (this.snapshot.state !== "ready") {
      return err("provider_unavailable", "The model catalog is not currently available.", true);
    }
    if (!this.activeKey) return err("provider_unavailable", "No active model has been selected.", true);
    const model = this.catalog.get(this.activeKey);
    if (!model) {
      this.activeKey = null;
      return err("provider_unavailable", "The active model is no longer available in the current catalog.", true);
    }
    return ok({ ...model, ...(model.modalities ? { modalities: [...model.modalities] } : {}) });
  }

  clearActiveModel(): void {
    this.activeKey = null;
  }
}
