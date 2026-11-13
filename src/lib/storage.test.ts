import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConversations, saveConversations, loadProvider, saveProvider, type StorageAdapter } from "./storage";
import type { Conversation } from "../types";

const { invokeMock, isTauriMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), isTauriMock: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock, isTauri: isTauriMock }));

class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const base: Conversation = {
  id: "chat-1", title: "Test", updatedAt: 10, projectId: "project-a",
  messages: [{ id: "message-1", role: "user", content: "hello", createdAt: 9 }]
};

beforeEach(() => {
  invokeMock.mockReset();
  isTauriMock.mockReturnValue(false);
});

describe("conversation workspace storage", () => {
  it("defaults to a local-compatible endpoint without selecting an unverified model", () => {
    const storage = new MemoryStorage();
    expect(loadProvider(storage)).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "",
      inferenceLocation: "local",
      credentialHandle: "none"
    });
  });
  it("persists a provider endpoint before a model has been discovered", () => {
    const storage = new MemoryStorage();
    const settings = { baseUrl: "https://api.example/v1", model: "", inferenceLocation: "remote" as const };
    saveProvider(settings, storage);
    expect(loadProvider(storage)).toEqual(settings);
  });
  it("defaults legacy provider settings to remote instead of inferring locality from localhost", () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:provider:v1", JSON.stringify({ baseUrl: "http://127.0.0.1:20128/v1", model: "local-model" }));
    expect(loadProvider(storage)).toMatchObject({ inferenceLocation: "remote" });
  });
  it("persists an explicit model inference location", () => {
    const storage = new MemoryStorage();
    const settings = { baseUrl: "http://127.0.0.1:20128/v1", model: "local-model", inferenceLocation: "local" as const };
    saveProvider(settings, storage);
    expect(loadProvider(storage)).toEqual(settings);
  });
  it("persists credential-free local provider mode", () => {
    const storage = new MemoryStorage();
    const settings = {
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      inferenceLocation: "local" as const,
      credentialHandle: "none" as const
    };
    saveProvider(settings, storage);
    expect(loadProvider(storage)).toEqual(settings);
  });
  it("persists the separate Ollama API-key profile across restarts", () => {
    const storage = new MemoryStorage();
    const settings = {
      baseUrl: "https://ollama.example/v1",
      model: "qwen3",
      inferenceLocation: "remote" as const,
      credentialHandle: "ollama" as const
    };
    saveProvider(settings, storage);
    expect(loadProvider(storage)).toEqual(settings);
  });
  it("preserves the explicit default credential profile", () => {
    const storage = new MemoryStorage();
    const settings = {
      baseUrl: "https://api.example/v1",
      model: "model-a",
      inferenceLocation: "remote" as const,
      credentialHandle: "default" as const
    };
    saveProvider(settings, storage);
    expect(loadProvider(storage)).toEqual(settings);
  });
  it("rejects oversized or control-character provider settings", () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:provider:v1", JSON.stringify({
      baseUrl: "https://api.example/v1",
      model: "invalid\\nmodel",
      inferenceLocation: "remote"
    }));
    expect(loadProvider(storage)).toEqual({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "",
      inferenceLocation: "local",
      credentialHandle: "none"
    });
    storage.setItem("nexus-au:provider:v1", JSON.stringify({
      baseUrl: "https://api.example/v1",
      model: "x".repeat(129),
      inferenceLocation: "remote"
    }));
    expect(loadProvider(storage).baseUrl).toBe("http://127.0.0.1:11434/v1");
  });
  it("round-trips project ownership", async () => {
    const storage = new MemoryStorage();
    await saveConversations([base], storage);
    expect(await loadConversations(storage)).toEqual([base]);
  });
  it("migrates legacy conversations without losing their content", async () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:conversations:v1", JSON.stringify([{ ...base, projectId: undefined }]));
    const loaded = await loadConversations(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("chat-1");
    expect(loaded[0]?.projectId).toBeUndefined();
    expect(storage.getItem("nexus-au:conversations:v2")).toContain("chat-1");
    expect(storage.getItem("nexus-au:conversations:v1")).not.toBeNull();
  });
  it("merges browser conversations into a populated native database before clearing legacy copies", async () => {
    const storage = new MemoryStorage();
    const native = { ...base, id: "native-chat", title: "Native", updatedAt: 30 };
    const nativeDuplicate = { ...base, title: "Native version", updatedAt: 25 };
    const browser = { ...base, id: "browser-chat", title: "Browser", updatedAt: 20 };
    const legacy = { ...base, id: "legacy-chat", title: "Legacy", updatedAt: 10 };
    const duplicate = { ...base, title: "Stale browser duplicate", updatedAt: 5 };
    storage.setItem("nexus-au:conversations:v2", JSON.stringify([browser, duplicate]));
    storage.setItem("nexus-au:conversations:v1", JSON.stringify([legacy]));
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => command === "load_conversations" ? [native, nativeDuplicate] : undefined);

    const loaded = await loadConversations(storage);

    expect(loaded.map(item => item.id)).toEqual(["native-chat", "chat-1", "browser-chat", "legacy-chat"]);
    expect(loaded.find(item => item.id === "chat-1")?.title).toBe("Native version");
    expect(invokeMock).toHaveBeenCalledWith("save_conversations", { conversations: loaded });
    expect(storage.getItem("nexus-au:conversations:v2")).toBe("[]");
    expect(storage.getItem("nexus-au:conversations:v1")).toBe("[]");
  });

  it("retains browser recovery data when native migration persistence fails", async () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:conversations:v2", JSON.stringify([base]));
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "load_conversations") return [{ ...base, id: "native-chat" }];
      throw new Error("SQLite unavailable");
    });

    await expect(loadConversations(storage)).rejects.toThrow("SQLite unavailable");
    expect(storage.getItem("nexus-au:conversations:v2")).toContain("chat-1");
  });

  it("drops malformed conversations and malformed messages", async () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:conversations:v2", JSON.stringify([
      { ...base, messages: [{ id: "bad", role: "system", content: "x", createdAt: 1 }, base.messages[0]] },
      { id: "broken" }
    ]));
    const loaded = await loadConversations(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.messages).toHaveLength(1);
  });
});
