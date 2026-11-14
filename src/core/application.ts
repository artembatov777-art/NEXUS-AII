import type { ConversationId, Message } from "./domain";
import type { ConversationService } from "./conversation";
import type { ModelEvent, ModelRouter } from "./model";
import { err, ok, type Result } from "./result";

export interface SendMessageInput {
  conversationId: ConversationId;
  providerId: string;
  model: string;
  content: string;
  signal?: AbortSignal;
}

export interface SendMessageOutput {
  conversationId: ConversationId;
  assistantText: string;
}

export class NexusApplication {
  constructor(
    private readonly conversations: ConversationService,
    private readonly models: ModelRouter
  ) {}

  async *sendMessage(input: SendMessageInput): AsyncIterable<Result<SendMessageOutput | ModelEvent>> {
    const content = input.content.trim();
    if (!content) {
      yield err("validation", "Message cannot be empty.");
      return;
    }

    const userMessage = await this.conversations.appendMessage(input.conversationId, {
      role: "user",
      content
    });
    if (!userMessage.ok) {
      yield userMessage;
      return;
    }

    let assistantText = "";
    try {
      const stream = this.models.stream(input.providerId, {
        model: input.model,
        messages: userMessage.value.messages.map((message: Message) => ({
          role: message.role,
          content: message.content
        })),
        signal: input.signal
      });

      for await (const event of stream) {
        if (event.type === "text_delta") assistantText += event.text;
        yield ok(event);
      }

      if (assistantText.trim()) {
        const saved = await this.conversations.appendMessage(input.conversationId, {
          role: "assistant",
          content: assistantText
        });
        if (!saved.ok) {
          yield saved;
          return;
        }
      }

      yield ok({ conversationId: input.conversationId, assistantText });
    } catch (cause) {
      // Preserve any text already shown to the caller before a provider failure
      // or cancellation. Otherwise the visible partial answer disappears on reload.
      if (assistantText.trim()) {
        const saved = await this.conversations.appendMessage(input.conversationId, {
          role: "assistant",
          content: assistantText
        });
        if (!saved.ok) {
          yield saved;
          return;
        }
      }
      const message = cause instanceof Error ? cause.message : "Unexpected model error.";
      // The request may already have reached the provider (and incurred usage), so a
      // failed stream is not safe to retry automatically without provider idempotency.
      yield err(input.signal?.aborted ? "cancelled" : "provider_unavailable", message);
    }
  }
}
