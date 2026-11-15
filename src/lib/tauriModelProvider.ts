import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { ModelRouter, type ModelEvent, type ModelProvider, type ModelRequest } from "../core/model";
import { classifyModelTask, orderModelRouteCandidates, streamWithModelFailover, type ModelRouteCandidate } from "../core/modelRouting";
import { ok, err, type Result } from "../core/result";
import type { ModelDescriptor } from "../core/domain";
import type { ProviderSettings } from "../types";
import { normalizeProviderFailure, normalizeProviderModelIds, providerEndpointError } from "./providerEndpoint";

export const NATIVE_MODEL_PROVIDER_ID = "nexus.native-provider";

function isValidModelId(model: string): boolean {
  return model.trim().length > 0
    && new TextEncoder().encode(model).byteLength <= 128
    && !/[\u0000-\u001f\u007f]/.test(model);
}

/** Model discovery is an idempotent GET, so retry one transient failure. Chat POSTs are never auto-retried to avoid duplicate generation or billing. */
async function invokeCatalogWithRetry(baseUrl: string, credentialHandle: string, protocol: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await invoke<unknown>("list_provider_models", { baseUrl, credentialHandle, protocol });
    } catch (cause) {
      lastError = cause;
      const failure = normalizeProviderFailure(cause);
      if (!failure.retryable || attempt === 1) throw cause;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

class TauriModelProvider implements ModelProvider {
  private discoveredModels = new Set<string>();

  constructor(readonly id: string, private readonly settings: ProviderSettings) {}

  async listModels(): Promise<Result<ModelDescriptor[]>> {
    if (this.settings.model && !isValidModelId(this.settings.model)) {
      return err("validation", "Configured model name is invalid.");
    }
    const endpointError = providerEndpointError(this.settings.baseUrl);
    if (endpointError) return err("validation", endpointError);
    try {
      const ids = await invokeCatalogWithRetry(
        this.settings.baseUrl,
        this.settings.credentialHandle ?? "default",
        this.settings.providerProtocol ?? "openai-chat-completions"
      );
      const uniqueIds = normalizeProviderModelIds(ids);
      this.discoveredModels = new Set(uniqueIds);
      return ok(uniqueIds.map(id => ({
        id,
        providerId: this.id,
        displayName: id,
        supportsStreaming: true,
        supportsTools: false,
        declaredLocation: this.settings.inferenceLocation,
        // The current native request contract accepts text only. Never infer
        // image/audio support from an OpenAI-compatible endpoint's model IDs.
        modalities: ["text"]
      })));
    } catch (cause) {
      this.discoveredModels.clear();
      const failure = normalizeProviderFailure(cause);
      return err(failure.code, failure.message, failure.retryable);
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (!isTauri()) throw new Error("Native model requests are available only in the desktop host.");
    if (request.signal?.aborted) throw new Error("Model request was cancelled.");
    const endpointError = providerEndpointError(this.settings.baseUrl);
    if (endpointError) throw new Error(endpointError);
    if (!isValidModelId(request.model)) throw new Error("Requested model ID is invalid.");
    if (request.messages.some(message => message.role === "tool")) {
      throw new Error("Tool-role messages are not supported by the native provider adapter yet.");
    }
    // A configured model name is only a preference, not proof that the provider
    // actually serves it. Discover before the first generation request.
    if (!this.discoveredModels.has(request.model)) {
      const catalog = await this.listModels();
      if (request.signal?.aborted) throw new Error("Model request was cancelled.");
      if (!catalog.ok) {
        throw Object.assign(new Error(catalog.error.message), {
          code: catalog.error.code,
          retryable: catalog.error.retryable
        });
      }
    }
    if (!this.discoveredModels.has(request.model)) {
      throw new Error("Requested model is not present in the discovered provider catalog.");
    }
    const channel = new Channel<{ type: "text_delta" | "usage" | "completed"; text?: string; finishReason?: string; inputTokens?: number; outputTokens?: number }>();
    const streamId = crypto.randomUUID();
    let completed = false;
    let cancellationSent = false;
    const cancelNativeStream = () => {
      if (cancellationSent) return;
      cancellationSent = true;
      void invoke<boolean>("cancel_chat_stream", { streamId }).catch(() => false);
    };
    const queue: ModelEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let failure: Error | null = null;
    let requestError: unknown = null;
    let rejectAbort!: (reason: Error) => void;
    let waitingForNativeCompletion = false;
    const abortPromise = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const abortHandler = () => {
      const error = new Error("Model request was cancelled.");
      if (!done) cancelNativeStream();
      failure = error;
      done = true;
      wake?.();
      wake = null;
      if (waitingForNativeCompletion) rejectAbort(error);
    };
    request.signal?.addEventListener("abort", abortHandler, { once: true });
    channel.onmessage = event => {
      if (event.type === "text_delta" && typeof event.text === "string") queue.push({ type: "text_delta", text: event.text });
      else if (event.type === "usage") queue.push({ type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens });
      else if (event.type === "completed") { queue.push({ type: "completed", finishReason: event.finishReason }); done = true; }
      else failure = new Error("Provider returned an unsupported stream event.");
      wake?.();
      wake = null;
    };
    try {
      const streamPromise = invoke("send_chat_stream", {
        baseUrl: this.settings.baseUrl,
        credentialHandle: this.settings.credentialHandle ?? "default",
        protocol: this.settings.providerProtocol ?? "openai-chat-completions",
        model: request.model,
        messages: request.messages.map(message => ({ role: message.role, content: message.content })),
        temperature: request.temperature ?? null,
        maxOutputTokens: request.maxOutputTokens ?? null,
        streamId,
        onEvent: channel
      });
      void streamPromise.then(
        () => {
          if (!done) {
            failure = new Error("Provider stream ended without a completion event.");
            done = true;
            wake?.();
            wake = null;
          }
        },
        error => {
          requestError = error;
          done = true;
          wake?.();
          wake = null;
        }
      );
      while (!done || queue.length) {
        if (request.signal?.aborted) throw new Error("Model request was cancelled.");
        if (failure) throw failure;
        const event = queue.shift();
        if (event) { yield event; continue; }
        if (requestError) {
          const failure = normalizeProviderFailure(requestError);
          throw Object.assign(new Error(failure.message), { code: failure.code, retryable: failure.retryable });
        }
        await new Promise<void>(resolve => { wake = resolve; });
      }
      if (failure) throw failure;
      if (requestError) {
          const failure = normalizeProviderFailure(requestError);
          throw Object.assign(new Error(failure.message), { code: failure.code, retryable: failure.retryable });
        }
      waitingForNativeCompletion = true;
      await Promise.race([streamPromise, abortPromise]);
      if (request.signal?.aborted) throw new Error("Model request was cancelled.");
      completed = true;
    } catch (cause) {
      // A failed native request has already released its registration. Do not
      // enqueue a cancellation for an ID that is no longer active.
      throw cause;
    } finally {
      request.signal?.removeEventListener("abort", abortHandler);
      if (!completed && !failure && !requestError) cancelNativeStream();
    }
  }
}

export interface TauriProviderProfile {
  /** Stable router identity for a compatible provider endpoint, for example nexus.ollama or nexus.cloud. */
  id: string;
  settings: ProviderSettings;
}

/** Builds a local Ollama-compatible profile without probing or starting Ollama. */
export function createOllamaProviderProfile(model = ""): TauriProviderProfile {
  return {
    id: "nexus.ollama",
    settings: {
      baseUrl: "http://127.0.0.1:11434/v1",
      model,
      inferenceLocation: "local",
      credentialHandle: "none"
    }
  };
}

/**
 * Registers multiple independent OpenAI-compatible endpoints in one router.
 * This is adapter preparation only: it never installs, launches, or connects
 * to a provider until a caller explicitly invokes listModels or stream.
 */
export function createTauriModelRouterForProfiles(profiles: TauriProviderProfile[]): ModelRouter | null {
  if (!isTauri() || profiles.length === 0) return null;
  const router = new ModelRouter();
  for (const profile of profiles) {
    if (!profile.id.trim() || profile.id.length > 128 || !profile.settings.baseUrl.trim()) {
      throw new Error("Provider profile ID and endpoint are required.");
    }
    const registered = router.register(new TauriModelProvider(profile.id, { ...profile.settings }));
    if (!registered.ok) throw new Error(registered.error.message);
  }
  return router;
}

class TaskAwareModelProvider implements ModelProvider {
  readonly id = NATIVE_MODEL_PROVIDER_ID;
  constructor(
    private readonly router: ModelRouter,
    private readonly profiles: TauriProviderProfile[],
    private readonly preferredProviderId?: string,
    private readonly routeMode: "auto" | "manual" = "auto"
  ) {}

  listModels() { return this.router.listModels(); }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const catalog = await this.router.listModels();
    if (!catalog.ok) throw Object.assign(new Error(catalog.error.message), {
      code: catalog.error.code, retryable: catalog.error.retryable
    });
    const task = classifyModelTask(request.messages);
    const candidates: ModelRouteCandidate[] = [];
    const eligible = this.routeMode === "manual" && this.preferredProviderId
      ? this.profiles.filter(profile => profile.id === this.preferredProviderId)
      : this.profiles;
    for (const profile of eligible) {
      const available = catalog.value.filter(model => model.providerId === profile.id);
      if (!available.length) continue;
      const chosen = available.find(model => model.id === profile.settings.model) ?? available[0];
      if (!chosen) continue;
      candidates.push({
        providerId: profile.id,
        modelId: chosen.id,
        family: providerFamily(profile.settings)
      });
    }
    const ordered = orderModelRouteCandidates(candidates, task,
      this.routeMode === "manual" ? this.preferredProviderId : undefined);
    if (!ordered.length) {
      const failed = this.router.getProviderFailures();
      const detail = failed.map(item => item.providerId + ": " + item.message).join("\\n");
      throw new Error(detail || "No configured provider returned a verified model catalog.");
    }
    yield* streamWithModelFailover(this.router, ordered, {
      messages: request.messages,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.signal ? { signal: request.signal } : {})
    });
  }
}

function providerFamily(settings: ProviderSettings): string {
  if (settings.providerProtocol === "anthropic-messages") return "anthropic";
  const host = (() => { try { return new URL(settings.baseUrl).hostname.toLowerCase(); } catch { return ""; } })();
  if (host.includes("openai")) return "openai";
  if (host.includes("deepseek")) return "deepseek";
  if (host.includes("mistral")) return "mistral";
  if (host.includes("x.ai")) return "xai";
  if (host.includes("googleapis") || host.includes("generativelanguage")) return "gemini";
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return "ollama";
  return "other";
}

/**
 * Creates a single application router backed by every saved provider profile.
 * Catalogs are discovered concurrently; task selection is deterministic and
 * fallback is allowed only before the first visible text delta.
 */
export function createTauriAutoModelRouterForProfiles(
  profiles: TauriProviderProfile[],
  preferredProviderId?: string,
  routeMode: "auto" | "manual" = "auto"
): ModelRouter | null {
  if (!isTauri() || profiles.length === 0) return null;
  const router = new ModelRouter();
  for (const profile of profiles) {
    if (!profile.id.trim() || profile.id.length > 128 || !profile.settings.baseUrl.trim()) {
      throw new Error("Provider profile ID and endpoint are required.");
    }
    const registered = router.register(new TauriModelProvider(profile.id, { ...profile.settings }));
    if (!registered.ok) throw new Error(registered.error.message);
  }
  const aggregate = router.register(new TaskAwareModelProvider(router, profiles, preferredProviderId, routeMode));
  if (!aggregate.ok) throw new Error(aggregate.error.message);
  return router;
}

/** Default single-endpoint adapter retained for explicit provider checks and tests. */
export function createTauriModelRouter(settings: ProviderSettings): ModelRouter | null {
  return createTauriModelRouterForProfiles([{ id: NATIVE_MODEL_PROVIDER_ID, settings }]);
}
