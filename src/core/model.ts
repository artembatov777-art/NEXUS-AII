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

export class ModelRouter {
  private readonly providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): Result<void> {
    if (!provider.id.trim()) return err("validation", "Provider ID cannot be empty.");
    if (this.providers.has(provider.id)) {
      return err("validation", `Provider "${provider.id}" is already registered.`);
    }
    this.providers.set(provider.id, provider);
    return ok(undefined);
  }

  unregister(providerId: string): void {
    this.providers.delete(providerId);
  }

  getProvider(providerId: string): Result<ModelProvider> {
    const provider = this.providers.get(providerId);
    if (!provider) return err("provider_unavailable", `Provider "${providerId}" is not registered.`, true);
    return ok(provider);
  }

  async listModels(): Promise<Result<ModelDescriptor[]>> {
    const results = await Promise.all([...this.providers.values()].map(provider => provider.listModels()));
    const failed = results.find(result => !result.ok);
    if (failed && !failed.ok) return failed;
    return ok(results.flatMap(result => result.ok ? result.value : []));
  }

  async *stream(providerId: string, request: ModelRequest): AsyncIterable<ModelEvent> {
    const resolved = this.getProvider(providerId);
    if (!resolved.ok) throw new Error(resolved.error.message);
    if (!request.model.trim()) throw new Error("A model must be selected.");
    if (request.messages.length === 0) throw new Error("At least one message is required.");
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
}

/**
 * Provider-neutral in-memory catalog and active-model selection.
 * Runtime availability is based only on a successful provider catalog refresh;
 * it does not claim that a remote model is currently healthy or reachable.
 */
export class ModelRegistry {
  private readonly catalog = new Map<string, ModelDescriptor>();
  private activeKey: string | null = null;
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
    try {
      const result = await this.router.listModels();
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
        if (!model.id.trim() || !model.providerId.trim() || !model.displayName.trim()) {
          this.snapshot = {
            state: "unavailable",
            checkedAt: this.now(),
            modelCount: this.catalog.size,
            error: "Provider returned a model with missing identity metadata."
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
      this.snapshot = {
        state: "ready",
        checkedAt: this.now(),
        modelCount: this.catalog.size
      };
      return ok(this.listModels());
    } catch (cause) {
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
