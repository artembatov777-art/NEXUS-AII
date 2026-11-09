import { describe, expect, it } from "vitest";
import { loadConversations, saveConversations, type StorageAdapter } from "./storage";
import type { Conversation } from "../types";

class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const base: Conversation = {
  id: "chat-1", title: "Test", updatedAt: 10, projectId: "project-a",
  messages: [{ id: "message-1", role: "user", content: "hello", createdAt: 9 }]
};

describe("conversation workspace storage", () => {
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
  it("drops malformed conversations and malformed messages", async () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:conversations:v2", JSON.stringify([
      { ...base, messages: [{ id: "bad", role: "system", content: "x", createdAt: 1 }, base.messages[0]] },
      { id: "broken" }
    ]));
    const loaded = loadConversations(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.messages).toHaveLength(1);
  });
});
