import type { Conversation, ProviderSettings } from "../types";
import { DEFAULT_PROVIDER } from "../types";

const CHAT_KEY = "nexus-au:conversations:v2";
const LEGACY_CHAT_KEY = "nexus-au:conversations:v1";
const PROVIDER_KEY = "nexus-au:provider:v1";

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeConversation(value: unknown): Conversation | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string" ||
      typeof value.updatedAt !== "number" || !Array.isArray(value.messages)) return null;
  const messages = value.messages.filter((message): message is Record<string, unknown> =>
    isRecord(message) && typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" && typeof message.createdAt === "number"
  ).map(message => ({
    id: message.id as string,
    role: message.role as "user" | "assistant",
    content: message.content as string,
    createdAt: message.createdAt as number,
    ...(Array.isArray(message.sourceReferences) ? { sourceReferences: message.sourceReferences } : {})
  }));
  const projectId = typeof value.projectId === "string" && value.projectId.trim() ? value.projectId : undefined;
  return {
    id: value.id, title: value.title.slice(0, 120), messages, updatedAt: value.updatedAt,
    ...(projectId ? { projectId } : {})
  };
}

export function loadConversations(storage: StorageAdapter = localStorage): Conversation[] {
  try {
    const current = storage.getItem(CHAT_KEY);
    const legacy = current === null ? storage.getItem(LEGACY_CHAT_KEY) : null;
    const parsed: unknown = JSON.parse(current ?? legacy ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const conversations = parsed.map(normalizeConversation).filter((item): item is Conversation => item !== null);
    if (current === null && legacy !== null) {
      // Persist the new schema first; retain v1 as recovery data.
      try { storage.setItem(CHAT_KEY, JSON.stringify(conversations)); } catch { /* Legacy data remains available. */ }
    }
    return conversations;
  } catch { return []; }
}

export function saveConversations(items: Conversation[], storage: StorageAdapter = localStorage): void {
  storage.setItem(CHAT_KEY, JSON.stringify(items));
}

export function loadProvider(storage: StorageAdapter = localStorage): ProviderSettings {
  try {
    const value = JSON.parse(storage.getItem(PROVIDER_KEY) ?? "null") as Partial<ProviderSettings> | null;
    return value?.baseUrl && value?.model ? { baseUrl: value.baseUrl, model: value.model } : DEFAULT_PROVIDER;
  } catch { return DEFAULT_PROVIDER; }
}

export function saveProvider(settings: ProviderSettings, storage: StorageAdapter = localStorage): void {
  storage.setItem(PROVIDER_KEY, JSON.stringify(settings));
}
