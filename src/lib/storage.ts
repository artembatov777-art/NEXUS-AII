import { invoke } from "@tauri-apps/api/core";
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

interface StoredConversationRead {
  items: Conversation[];
  present: boolean;
  valid: boolean;
}

function readConversationKey(storage: StorageAdapter, key: string): StoredConversationRead {
  let raw: string | null;
  try { raw = storage.getItem(key); }
  catch { return { items: [], present: true, valid: false }; }
  if (raw === null) return { items: [], present: false, valid: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { items: [], present: true, valid: false };
    return {
      items: parsed.map(normalizeConversation).filter((item): item is Conversation => item !== null),
      present: true,
      valid: true
    };
  } catch {
    return { items: [], present: true, valid: false };
  }
}

export async function loadConversations(storage: StorageAdapter = localStorage): Promise<Conversation[]> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const nativeRaw = await invoke<unknown[]>("load_conversations");
    const nativeItems = Array.isArray(nativeRaw)
      ? nativeRaw.map(normalizeConversation).filter((item): item is Conversation => item !== null)
      : [];
    const current = readConversationKey(storage, CHAT_KEY);
    const legacy = readConversationKey(storage, LEGACY_CHAT_KEY);

    // SQLite is authoritative for duplicate IDs, while distinct valid browser
    // records are imported even when the native database is already populated.
    const mergedById = new Map<string, Conversation>();
    for (const item of nativeItems) mergedById.set(item.id, item);
    for (const item of current.items) if (!mergedById.has(item.id)) mergedById.set(item.id, item);
    for (const item of legacy.items) if (!mergedById.has(item.id)) mergedById.set(item.id, item);
    const merged = [...mergedById.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const nativeIds = new Set(nativeItems.map(item => item.id));
    const hasUnpersistedBrowserRecords = [...current.items, ...legacy.items].some(item => !nativeIds.has(item.id));
    const needsPersistence = hasUnpersistedBrowserRecords ||
      nativeItems.length !== (Array.isArray(nativeRaw) ? nativeRaw.length : 0);

    if (needsPersistence) {
      // Do not clear either browser copy unless the full native replacement succeeds.
      await invoke("save_conversations", { conversations: merged });
    }
    // Duplicate browser records are safe to clear because SQLite already owns
    // their IDs and wins conflicts. Empty migration markers need no DB rewrite.
    for (const [key, source] of [[CHAT_KEY, current], [LEGACY_CHAT_KEY, legacy]] as const) {
      if (source.present && source.valid) {
        try { storage.setItem(key, "[]"); } catch { /* Native copy is safe; stale data will be deduplicated next launch. */ }
      }
    }
    return merged;
  }
  return readBrowserConversations(storage);
}

function readBrowserConversations(storage: StorageAdapter): Conversation[] {
  const current = readConversationKey(storage, CHAT_KEY);
  if (current.present) return current.valid ? current.items : [];
  const legacy = readConversationKey(storage, LEGACY_CHAT_KEY);
  if (!legacy.valid) return [];
  if (legacy.present) {
    // Persist the new schema first; retain v1 as recovery data.
    try { storage.setItem(CHAT_KEY, JSON.stringify(legacy.items)); } catch { /* Legacy data remains available. */ }
  }
  return legacy.items;
}

export async function saveConversations(items: Conversation[], storage: StorageAdapter = localStorage): Promise<void> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    await invoke("save_conversations", { conversations: items });
    return;
  }
  storage.setItem(CHAT_KEY, JSON.stringify(items));
}

export function loadProvider(storage: StorageAdapter = localStorage): ProviderSettings {
  try {
    const value = JSON.parse(storage.getItem(PROVIDER_KEY) ?? "null") as Partial<ProviderSettings> | null;
    return value?.baseUrl && value?.model ? {
      baseUrl: value.baseUrl,
      model: value.model,
      inferenceLocation: value.inferenceLocation === "local" ? "local" : "remote",
      ...(value.credentialHandle === "none" || value.credentialHandle === "ollama" ? { credentialHandle: value.credentialHandle } : {})
    } : DEFAULT_PROVIDER;
  } catch { return DEFAULT_PROVIDER; }
}

export function saveProvider(settings: ProviderSettings, storage: StorageAdapter = localStorage): void {
  storage.setItem(PROVIDER_KEY, JSON.stringify(settings));
}
