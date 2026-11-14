import { describe, expect, it } from "vitest";
import { ConversationService } from "./conversation";
import type { Conversation, ConversationId, ConversationSummary, Message } from "./domain";
import { ok } from "./result";

class MemoryRepository {
  items = new Map<string, Conversation>();

  async list() {
    const summaries: ConversationSummary[] = [...this.items.values()].map(item => ({
      id: item.id,
      title: item.title,
      messageCount: item.messages.length,
      updatedAt: item.updatedAt
    }));
    return ok(summaries);
  }

  async get(id: ConversationId) {
    return ok(this.items.get(id) ?? null);
  }

  async save(item: Conversation) {
    this.items.set(item.id, item);
    return ok(undefined);
  }

  async delete(id: ConversationId) {
    this.items.delete(id);
    return ok(undefined);
  }
}

function setup() {
  const repository = new MemoryRepository();
  let sequence = 0;
  const service = new ConversationService(
    repository,
    {
      conversationId: () => `conversation-${++sequence}` as ConversationId,
      messageId: () => `message-${++sequence}` as Message["id"]
    },
    { now: () => 1_700_000_000_000 }
  );
  return { repository, service };
}

describe("ConversationService", () => {
  it("creates and persists an empty conversation", async () => {
    const { repository, service } = setup();
    const result = await service.create();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("New conversation");
    expect(repository.items.has(result.value.id)).toBe(true);
  });

  it("trims and appends a message", async () => {
    const { service } = setup();
    const created = await service.create();
    if (!created.ok) throw new Error("Expected conversation creation to succeed");

    const result = await service.appendMessage(created.value.id, {
      role: "user",
      content: "  Hello NEXUS  "
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.messages[0]?.content).toBe("Hello NEXUS");
  });

  it("rejects empty messages", async () => {
    const { service } = setup();
    const created = await service.create();
    if (!created.ok) throw new Error("Expected conversation creation to succeed");

    const result = await service.appendMessage(created.value.id, {
      role: "user",
      content: "   "
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });

  it("rejects messages above the input limit", async () => {
    const { service } = setup();
    const created = await service.create();
    if (!created.ok) throw new Error("Expected conversation creation to succeed");

    const result = await service.appendMessage(created.value.id, {
      role: "user",
      content: "x".repeat(100_001)
    });

    expect(result.ok).toBe(false);
  });
});
