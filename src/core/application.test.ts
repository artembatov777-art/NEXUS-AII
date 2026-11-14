import { describe, expect, it } from "vitest";
import { ConversationService, type ConversationRepository } from "./conversation";
import type { Conversation, ConversationId, ConversationSummary, Message } from "./domain";
import { ModelRouter, type ModelProvider } from "./model";
import { NexusApplication } from "./application";
import { ok } from "./result";

class MemoryConversationRepository implements ConversationRepository {
  private readonly items = new Map<ConversationId, Conversation>();

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

  async save(conversation: Conversation) {
    this.items.set(conversation.id, conversation);
    return ok(undefined);
  }

  async delete(id: ConversationId) {
    this.items.delete(id);
    return ok(undefined);
  }
}

function setup(provider: ModelProvider) {
  const repository = new MemoryConversationRepository();
  let sequence = 0;
  const conversations = new ConversationService(
    repository,
    {
      conversationId: () => `conversation-${++sequence}` as ConversationId,
      messageId: () => `message-${++sequence}` as Message["id"]
    },
    { now: () => 1_700_000_000_000 }
  );
  const router = new ModelRouter();
  const registered = router.register(provider);
  if (!registered.ok) throw new Error(registered.error.message);
  return { repository, conversations, application: new NexusApplication(conversations, router) };
}

describe("NexusApplication", () => {
  it("persists partial assistant output when a provider stream fails", async () => {
    const provider: ModelProvider = {
      id: "test-provider",
      listModels: async () => ok([]),
      async *stream() {
        yield { type: "text_delta", text: "A partial answer" };
        throw new Error("Connection interrupted.");
      }
    };
    const { repository, conversations, application } = setup(provider);
    const created = await conversations.create();
    if (!created.ok) throw new Error("Conversation setup failed.");

    const events = [];
    for await (const event of application.sendMessage({
      conversationId: created.value.id,
      providerId: provider.id,
      model: "test-model",
      content: "Explain this."
    })) events.push(event);

    const stored = await repository.get(created.value.id);
    expect(stored.ok && stored.value?.messages.map(message => [message.role, message.content])).toEqual([
      ["user", "Explain this."],
      ["assistant", "A partial answer"]
    ]);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: { code: "provider_unavailable", retryable: false }
    });
  });

  it("persists partial assistant output when the caller cancels the stream", async () => {
    const provider: ModelProvider = {
      id: "test-provider",
      listModels: async () => ok([]),
      async *stream(request) {
        yield { type: "text_delta", text: "Partial before cancellation" };
        if (request.signal?.aborted) throw new Error("Request cancelled.");
      }
    };
    const { repository, conversations, application } = setup(provider);
    const created = await conversations.create();
    if (!created.ok) throw new Error("Conversation setup failed.");
    const controller = new AbortController();
    const events = [];

    for await (const event of application.sendMessage({
      conversationId: created.value.id,
      providerId: provider.id,
      model: "test-model",
      content: "Start a long answer.",
      signal: controller.signal
    })) {
      events.push(event);
      if (event.ok && "type" in event.value && event.value.type === "text_delta") controller.abort();
    }

    const stored = await repository.get(created.value.id);
    expect(stored.ok && stored.value?.messages.map(message => [message.role, message.content])).toEqual([
      ["user", "Start a long answer."],
      ["assistant", "Partial before cancellation"]
    ]);
    expect(events.at(-1)).toMatchObject({
      ok: false,
      error: { code: "cancelled", retryable: false }
    });
  });

  it("sends prepared project context and persists assistant source provenance", async () => {
    let received: Array<{ role: string; content: string }> = [];
    const provider: ModelProvider = {
      id: "test-provider", listModels: async () => ok([]),
      async *stream(request) { received = request.messages; yield { type: "text_delta", text: "Grounded answer" }; yield { type: "completed" }; }
    };
    const { repository, conversations, application } = setup(provider);
    const created = await conversations.create({ projectId: "project-7" });
    if (!created.ok) throw new Error("Conversation setup failed.");
    const events = [];
    for await (const event of application.sendMessage({
      conversationId: created.value.id, providerId: provider.id, model: "test-model", content: "What does the source say?",
      requestMessages: [{ role: "system", content: "Untrusted project reference: manual page 4." }, { role: "user", content: "What does the source say?" }],
      assistantMetadata: { sourceReferences: [{ documentId: "doc-7", sourceLabel: "Manual", page: 4, chunkId: "chunk-7" }] }
    })) events.push(event);
    expect(received).toEqual([{ role: "system", content: "Untrusted project reference: manual page 4." }, { role: "user", content: "What does the source say?" }]);
    expect(await repository.get(created.value.id)).toMatchObject({ ok: true, value: {
      projectId: "project-7", messages: [
        { role: "user", content: "What does the source say?" },
        { role: "assistant", content: "Grounded answer", metadata: { sourceReferences: [{ page: 4 }] } }
      ]
    }});
    expect(events.at(-1)).toMatchObject({ ok: true, value: { assistantText: "Grounded answer" } });
  });

});