import { invoke, isTauri } from "@tauri-apps/api/core";
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
    return ok([{
      id: this.settings.model,
      providerId: this.id,
      displayName: this.settings.model,
      supportsStreaming: false,
      supportsTools: false
    }]);
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    if (!isTauri()) throw new Error("Native model requests are available only in the desktop host.");
    if (request.signal?.aborted) throw new Error("Model request was cancelled.");
    if (request.model !== this.settings.model || !request.model.trim()) throw new Error("Requested model does not match the configured model.");
    const response = await invoke<string>("send_chat", {
      baseUrl: this.settings.baseUrl,
      credentialHandle: "default",
      model: request.model,
      messages: request.messages.map(message => ({ role: message.role, content: message.content }))
    });
    if (request.signal?.aborted) throw new Error("Model request was cancelled.");
    if (typeof response !== "string" || !response.trim() || response.length > 48_000) {
      throw new Error("Native model response is empty or exceeds the planner response limit.");
    }
    yield { type: "text_delta", text: response };
    yield { type: "completed", finishReason: "stop" };
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
