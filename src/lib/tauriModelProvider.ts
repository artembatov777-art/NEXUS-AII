import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { ModelRouter, type ModelEvent, type ModelProvider, type ModelRequest } from "../core/model";
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
async function invokeCatalogWithRetry(baseUrl: string, credentialHandle: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await invoke<unknown>("list_provider_models", { baseUrl, credentialHandle });
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
        this.settings.credentialHandle ?? "default"
      );
      const uniqueIds = normalizeProviderModelIds(ids);
      return ok(uniqueIds.map(id => ({
        id,
        providerId: this.id,
        displayName: id,
        supportsStreaming: true,
        supportsTools: false,
        declaredLocation: this.settings.inferenceLocation
      })));
    } catch (cause) {
      const failure = normalizeProviderFailure(cause);
      return err(failure.code, failure.message, failure.retryable);
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (!isTauri()) throw new Error("Native model requests are available only in the desktop host.");
    if (request.signal?.aborted) throw new Error("Model request was cancelled.");
    const endpointError = providerEndpointError(this.settings.baseUrl);
    if (endpointError) throw new Error(endpointError);
    if (!isValidModelId(request.model) || request.model !== this.settings.model) throw new Error("Requested model does not match the configured model.");
    if (request.messages.some(message => message.role === "tool")) {
      throw new Error("Tool-role messages are not supported by the native provider adapter yet.");
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
  /** Stable router identity, for example nexus.ollama or nexus.omniroute. */
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
 * Builds a future OmniRoute profile from an owner-supplied HTTPS endpoint.
 * This only validates and stores configuration; it never connects to it.
 */
export function createOmniRouteProviderProfile(
  baseUrl: string,
  model: string,
  credentialHandle: "default" | "ollama" = "default"
): TauriProviderProfile {
  const endpointError = providerEndpointError(baseUrl);
  if (endpointError || !baseUrl.trim().startsWith("https://")) {
    throw new Error("OmniRoute must be configured with a valid HTTPS endpoint.");
  }
  return {
    id: "nexus.omniroute",
    settings: { baseUrl: baseUrl.trim(), model, inferenceLocation: "remote", credentialHandle }
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

/** Default single-endpoint adapter retained for the current settings UI. */
export function createTauriModelRouter(settings: ProviderSettings): ModelRouter | null {
  return createTauriModelRouterForProfiles([{ id: NATIVE_MODEL_PROVIDER_ID, settings }]);
}
