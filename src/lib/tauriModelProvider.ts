import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { ModelRouter, type ModelEvent, type ModelProvider, type ModelRequest } from "../core/model";
import { ok, err, type Result } from "../core/result";
import type { ModelDescriptor } from "../core/domain";
import type { ProviderSettings } from "../types";
import { normalizeProviderFailure, normalizeProviderModelIds, providerEndpointError } from "./providerEndpoint";

export const NATIVE_MODEL_PROVIDER_ID = "nexus.native-provider";

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
  readonly id = NATIVE_MODEL_PROVIDER_ID;
  constructor(private readonly settings: ProviderSettings) {}

  async listModels(): Promise<Result<ModelDescriptor[]>> {
    if (!this.settings.model.trim() || this.settings.model.length > 128) {
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
      if (!uniqueIds.includes(this.settings.model)) uniqueIds.unshift(this.settings.model);
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
    if (request.model !== this.settings.model || !request.model.trim()) throw new Error("Requested model does not match the configured model.");
    if (request.messages.some(message => message.role === "tool")) {
      throw new Error("Tool-role messages are not supported by the native provider adapter yet.");
    }
    const channel = new Channel<{ type: "text_delta" | "usage" | "completed"; text?: string; finishReason?: string; inputTokens?: number; outputTokens?: number }>();
    const streamId = crypto.randomUUID();
    let completed = false;
    const cancelNativeStream = () => {
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
      cancelNativeStream();
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
    } finally {
      request.signal?.removeEventListener("abort", abortHandler);
      if (!completed) cancelNativeStream();
    }
  }
}

/** Provider adapter keeps credentials in the native OS keyring and never exposes them to the webview. */
export function createTauriModelRouter(settings: ProviderSettings): ModelRouter | null {
  if (!isTauri() || !settings.baseUrl.trim() || !settings.model.trim()) return null;
  const router = new ModelRouter();
  const registered = router.register(new TauriModelProvider({ ...settings }));
  if (!registered.ok) throw new Error(registered.error.message);
  return router;
}
