import type { Conversation, ConversationId, ConversationSummary, Message } from "./domain";
import { err, ok, type Result } from "./result";

export interface ConversationRepository {
  list(): Promise<Result<ConversationSummary[]>>;
  get(id: ConversationId): Promise<Result<Conversation | null>>;
  save(conversation: Conversation): Promise<Result<void>>;
  delete(id: ConversationId): Promise<Result<void>>;
}

export interface IdFactory {
  conversationId(): ConversationId;
  messageId(): Message["id"];
}

export interface Clock {
  now(): number;
}

export interface CreateConversationInput {
  title?: string;
  firstMessage?: Pick<Message, "role" | "content">;
}

export class ConversationService {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly ids: IdFactory,
    private readonly clock: Clock
  ) {}

  async create(input: CreateConversationInput = {}): Promise<Result<Conversation>> {
    const title = input.title?.trim() || "New conversation";
    if (title.length > 120) {
      return err("validation", "Conversation title must be 120 characters or fewer.");
    }

    const now = this.clock.now();
    const messages: Message[] = [];
    if (input.firstMessage) {
      const content = input.firstMessage.content.trim();
      if (!content) return err("validation", "The first message cannot be empty.");
      if (content.length > 100_000) return err("validation", "Message is too long.");
      messages.push({
        id: this.ids.messageId(),
        role: input.firstMessage.role,
        content,
        createdAt: now
      });
    }

    const conversation: Conversation = {
      id: this.ids.conversationId(),
      title,
      messages,
      createdAt: now,
      updatedAt: now,
      schemaVersion: 1
    };

    const saved = await this.repository.save(conversation);
    if (!saved.ok) return saved;
    return ok(conversation);
  }

  async appendMessage(
    conversationId: ConversationId,
    message: Pick<Message, "role" | "content">
  ): Promise<Result<Conversation>> {
    const content = message.content.trim();
    if (!content) return err("validation", "Message cannot be empty.");
    if (content.length > 100_000) return err("validation", "Message is too long.");

    const loaded = await this.repository.get(conversationId);
    if (!loaded.ok) return loaded;
    if (!loaded.value) return err("validation", "Conversation was not found.");

    const now = this.clock.now();
    const updated: Conversation = {
      ...loaded.value,
      messages: [
        ...loaded.value.messages,
        { id: this.ids.messageId(), role: message.role, content, createdAt: now }
      ],
      updatedAt: now
    };

    const saved = await this.repository.save(updated);
    if (!saved.ok) return saved;
    return ok(updated);
  }
}
