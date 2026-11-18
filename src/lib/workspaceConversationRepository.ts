import type { Conversation as DomainConversation, ConversationId, ConversationSummary, Message } from "../core/domain";
import type { ConversationRepository } from "../core/conversation";
import { err, ok, type Result } from "../core/result";
import type { ChatMessage, Conversation as UiConversation } from "../types";
import { loadConversations, saveConversations, type StorageAdapter } from "./storage";

const writeQueues = new WeakMap<StorageAdapter, Promise<void>>();
function serialize<T>(storage: StorageAdapter, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(storage) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writeQueues.set(storage, current.then(() => undefined, () => undefined));
  return current;
}
function toDomain(item: UiConversation): DomainConversation {
  const messages: Message[] = item.messages.filter(message => message.id !== "welcome").map(message => ({
    id: message.id as Message["id"], role: message.role, content: message.content, createdAt: message.createdAt,
    ...((message.sourceReferences?.length || message.imageAttachment) ? { metadata: { ...(message.sourceReferences?.length ? { sourceReferences: message.sourceReferences } : {}), ...(message.imageAttachment ? { imageAttachment: message.imageAttachment } : {}) } } : {})
  }));
  return {
    id: item.id as ConversationId, title: item.title.slice(0, 120), messages,
    createdAt: messages[0]?.createdAt ?? item.updatedAt, updatedAt: item.updatedAt, schemaVersion: 1,
    ...(item.projectId ? { projectId: item.projectId } : {})
  };
}
function toUi(item: DomainConversation): UiConversation {
  const messages: ChatMessage[] = item.messages.map(message => {
    const refs = message.metadata?.sourceReferences;
    const imageAttachment = message.metadata?.imageAttachment;
    return {
      id: message.id, role: message.role === "assistant" ? "assistant" : "user",
      content: message.content, createdAt: message.createdAt,
      ...(Array.isArray(refs) ? { sourceReferences: refs as ChatMessage["sourceReferences"] } : {}),
      ...(imageAttachment && typeof imageAttachment === "object" ? { imageAttachment: imageAttachment as ChatMessage["imageAttachment"] } : {})
    };
  });
  return { id: item.id, title: item.title, messages, updatedAt: item.updatedAt, ...(item.projectId ? { projectId: item.projectId } : {}) };
}

/** Durable adapter over browser storage and the desktop SQLite workspace commands. */
export class WorkspaceConversationRepository implements ConversationRepository {
  constructor(private readonly storage: StorageAdapter) {}
  async list(): Promise<Result<ConversationSummary[]>> {
    try {
      const items = await loadConversations(this.storage);
      return ok(items.map(item => ({ id: item.id as ConversationId, title: item.title, messageCount: item.messages.filter(m => m.id !== "welcome").length, updatedAt: item.updatedAt })));
    } catch (cause) { return err("storage_failed", cause instanceof Error ? cause.message : "Could not list conversations.", true); }
  }
  async get(id: ConversationId): Promise<Result<DomainConversation | null>> {
    try {
      const item = (await loadConversations(this.storage)).find(candidate => candidate.id === id);
      return ok(item ? toDomain(item) : null);
    } catch (cause) { return err("storage_failed", cause instanceof Error ? cause.message : "Could not load conversation.", true); }
  }
  async save(conversation: DomainConversation): Promise<Result<void>> {
    try {
      await serialize(this.storage, async () => {
        const items = await loadConversations(this.storage);
        const next = items.filter(item => item.id !== conversation.id);
        next.push(toUi(conversation)); next.sort((left, right) => right.updatedAt - left.updatedAt);
        await saveConversations(next, this.storage);
      });
      return ok(undefined);
    } catch (cause) { return err("storage_failed", cause instanceof Error ? cause.message : "Could not save conversation.", true); }
  }
  async delete(id: ConversationId): Promise<Result<void>> {
    try {
      await serialize(this.storage, async () => {
        const items = await loadConversations(this.storage);
        await saveConversations(items.filter(item => item.id !== id), this.storage);
      });
      return ok(undefined);
    } catch (cause) { return err("storage_failed", cause instanceof Error ? cause.message : "Could not delete conversation.", true); }
  }
  replaceAll(items: UiConversation[]): Promise<void> {
    return serialize(this.storage, () => saveConversations(items, this.storage));
  }
}
export { toDomain as mapUiConversationToDomain, toUi as mapDomainConversationToUi };
