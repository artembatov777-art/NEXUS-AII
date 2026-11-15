import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Conversation, ProviderSettings } from "../types";
import { DEFAULT_PROVIDER } from "../types";
import { isValidCredentialHandle } from "./providerCredentials";

const CHAT_KEY = "nexus-au:conversations:v2";
const LEGACY_CHAT_KEY = "nexus-au:conversations:v1";
const PROVIDER_KEY = "nexus-au:provider:v1";
const MAX_BROWSER_IMAGE_ATTACHMENT_BYTES = 4_400_000;

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
    ...(Array.isArray(message.sourceReferences) ? { sourceReferences: message.sourceReferences } : {}),
    ...(isValidStoredImageAttachment(message.imageAttachment) ? { imageAttachment: message.imageAttachment } : {})
  }));
  const projectId = typeof value.projectId === "string" && value.projectId.trim() ? value.projectId : undefined;
  return {
    id: value.id, title: value.title.slice(0, 120), messages, updatedAt: value.updatedAt,
    ...(projectId ? { projectId } : {})
  };
}


function isValidStoredImageAttachment(value: unknown): value is NonNullable<Conversation["messages"][number]["imageAttachment"]> {
  if (!isRecord(value) || !["image/png", "image/jpeg", "image/webp"].includes(String(value.mimeType)) ||
      typeof value.data !== "string" || value.data.length > 4_300_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data) || value.data.length % 4 !== 0 ||
      !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) <= 0 ||
      (value.byteLength as number) > 3_200_000 ||
      typeof value.model !== "string" || !value.model.trim() || value.model.length > 160 ||
      typeof value.aspectRatio !== "string" ||
      !["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"].includes(value.aspectRatio) ||
      (value.imageSize !== "1K" && value.imageSize !== "2K")) return false;
  const padding = value.data.endsWith("==") ? 2 : value.data.endsWith("=") ? 1 : 0;
  const unpadded = value.data.slice(0, value.data.length - padding);
  const validPadding = !unpadded.includes("=") &&
    (padding === 0 || (padding === 1 && unpadded.length % 4 === 3) || (padding === 2 && unpadded.length % 4 === 2));
  return validPadding && (value.data.length / 4) * 3 - padding === value.byteLength;
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
  if (isTauri()) {
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
  const imageBytes = items.reduce((total, conversation) => total +
    conversation.messages.reduce((messageTotal, message) => messageTotal + (message.imageAttachment?.data.length ?? 0), 0), 0);
  if (imageBytes > MAX_BROWSER_IMAGE_ATTACHMENT_BYTES) {
    throw new Error("Generated image history exceeds the browser storage budget. Export a workspace backup or remove older image messages before saving more images.");
  }
  storage.setItem(CHAT_KEY, JSON.stringify(items));
}

export function loadProvider(storage: StorageAdapter = localStorage): ProviderSettings {
  try {
    const value = JSON.parse(storage.getItem(PROVIDER_KEY) ?? "null") as Partial<ProviderSettings> | null;
    if (
      typeof value?.baseUrl !== "string" ||
      value.baseUrl.trim().length === 0 ||
      value.baseUrl.length > 2048 ||
      /[\u0000-\u001f\u007f]/.test(value.baseUrl) ||
      typeof value.model !== "string" ||
      value.model.length > 128 ||
      /[\u0000-\u001f\u007f]/.test(value.model)
    ) return DEFAULT_PROVIDER;

    const credentialHandle = value.credentialHandle;
    const safeCredentialHandle = isValidCredentialHandle(credentialHandle)
      ? credentialHandle
      : undefined;

    return {
      baseUrl: value.baseUrl.trim(),
      model: value.model.trim(),
      inferenceLocation: value.inferenceLocation === "local" ? "local" : "remote",
      ...(safeCredentialHandle ? { credentialHandle: safeCredentialHandle } : {}),
      ...(value.providerProtocol === "anthropic-messages" ? { providerProtocol: "anthropic-messages" as const } : {}),
      ...(value.routeMode === "manual" ? { routeMode: "manual" as const } : {})
    };
  } catch { return DEFAULT_PROVIDER; }
}

export function saveProvider(settings: ProviderSettings, storage: StorageAdapter = localStorage): void {
  storage.setItem(PROVIDER_KEY, JSON.stringify(settings));
}
