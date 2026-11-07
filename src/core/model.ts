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
