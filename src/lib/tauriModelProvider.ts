import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { ModelRouter, type ModelEvent, type ModelProvider, type ModelRequest } from "../core/model";
import { ok, err, type Result } from "../core/result";
import type { ModelDescriptor } from "../core/domain";
import type { ProviderSettings } from "../types";

export const NATIVE_MODEL_PROVIDER_ID = "nexus.native-provider";

class TauriModelProvider implements ModelProvider {
  readonly id = NATIVE_MODEL_PROVIDER_ID;
  constructor(private readonly settings: ProviderSettings) {}

  async listModels(): Promise<Result<ModelDescriptor[]>> {
    if (!this.settings.model.trim() || this.settings.model.length > 128) {
      return err("validation", "Configured model name is invalid.");
    }
    try {
      const ids = await invoke<string[]>("list_provider_models", {
        baseUrl: this.settings.baseUrl,
        credentialHandle: "default"
      });
      const uniqueIds = [...new Set(ids.filter(id =>
        typeof id === "string" && id.trim().length > 0 && id.length <= 128
      ))];
      if (!uniqueIds.includes(this.settings.model)) uniqueIds.unshift(this.settings.model);
      return ok(uniqueIds.map(id => ({
        id,
        providerId: this.id,
        displayName: id,
        supportsStreaming: true,
        supportsTools: false
      })));
    } catch (cause) {
      return err("provider_unavailable", cause instanceof Error ? cause.message : "Could not load models from the configured gateway.", true);
    }
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (!isTauri()) throw new Error("Native model requests are available only in the desktop host.");
    if (request.signal?.aborted) throw new Error("Model request was cancelled.");
    if (request.model !== this.settings.model || !request.model.trim()) throw new Error("Requested model does not match the configured model.");
    const channel = new Channel<{ type: "text_delta" | "completed"; text?: string; finishReason?: string }>();
    const queue: ModelEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    let failure: Error | null = null;
    channel.onmessage = event => {
      if (event.type === "text_delta" && typeof event.text === "string") queue.push({ type: "text_delta", text: event.text });
      else if (event.type === "completed") { queue.push({ type: "completed", finishReason: event.finishReason }); done = true; }
      else failure = new Error("Provider returned an unsupported stream event.");
      wake?.();
      wake = null;
    };
    const streamPromise = invoke("send_chat_stream", {
      baseUrl: this.settings.baseUrl,
      credentialHandle: "default",
      model: request.model,
      messages: request.messages.map(message => ({ role: message.role, content: message.content })),
      onEvent: channel
    });
    let requestError: unknown = null;
    void streamPromise.catch(error => { requestError = error; done = true; wake?.(); wake = null; });
    while (!done || queue.length) {
      if (request.signal?.aborted) throw new Error("Model request was cancelled.");
      if (failure) throw failure;
      const event = queue.shift();
      if (event) { yield event; continue; }
      if (requestError) throw requestError instanceof Error ? requestError : new Error(String(requestError));
      await new Promise<void>(resolve => { wake = resolve; });
    }
    await streamPromise;
    if (request.signal?.aborted) throw new Error("Model request was cancelled.");
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
