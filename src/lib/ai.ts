import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ChatMessage, ProviderSettings } from "../types";

export async function sendMessage(
  settings: ProviderSettings,
  apiKey: string,
  messages: ChatMessage[]
): Promise<string> {
  if (!isTauri()) {
    return "Browser preview mode is active. The NEXUS AU interface and local conversation history work here, but AI requests need the native Tauri backend. Open the desktop app to connect your provider securely. No API key was sent or stored by this preview.";
  }
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
