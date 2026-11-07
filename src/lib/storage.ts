import type { Conversation, ProviderSettings } from "../types";
import { DEFAULT_PROVIDER } from "../types";

const CHAT_KEY = "nexus-au:conversations:v1";
const PROVIDER_KEY = "nexus-au:provider:v1";

export function loadConversations(): Conversation[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CHAT_KEY) ?? "[]");
    return Array.isArray(value) ? value as Conversation[] : [];
  } catch {
    return [];
  }
}
export function saveConversations(items: Conversation[]): void {
  localStorage.setItem(CHAT_KEY, JSON.stringify(items));
}
export function loadProvider(): ProviderSettings {
  try {
    const value = JSON.parse(localStorage.getItem(PROVIDER_KEY) ?? "null") as Partial<ProviderSettings> | null;
    return value?.baseUrl && value?.model
      ? { baseUrl: value.baseUrl, model: value.model }
      : DEFAULT_PROVIDER;
  } catch {
    return DEFAULT_PROVIDER;
  }
}
export function saveProvider(settings: ProviderSettings): void {
  localStorage.setItem(PROVIDER_KEY, JSON.stringify(settings));
}