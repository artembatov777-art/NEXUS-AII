import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ProviderSettings } from "../types";

export async function sendMessage(
  settings: ProviderSettings,
  apiKey: string,
  messages: ChatMessage[]
): Promise<string> {
  if (!apiKey.trim()) throw new Error("Enter an API key in provider settings.");
  if (!settings.baseUrl.trim() || !settings.model.trim()) {
    throw new Error("Configure the provider URL and model first.");
  }
  return invoke<string>("send_chat", {
    baseUrl: settings.baseUrl,
    apiKey,
    model: settings.model,
    messages: messages.map(({ role, content }) => ({ role, content }))
  });
}