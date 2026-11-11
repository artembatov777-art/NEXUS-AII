export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type ConversationId = Brand<string, "ConversationId">;
export type MessageId = Brand<string, "MessageId">;
export type TraceId = Brand<string, "TraceId">;

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  id: MessageId;
  role: MessageRole;
  content: string;
  createdAt: number;
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: ConversationId;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface ConversationSummary {
  id: ConversationId;
  title: string;
  messageCount: number;
  updatedAt: number;
}

export interface ModelDescriptor {
  id: string;
  providerId: string;
  displayName: string;
  contextWindow?: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  declaredLocation?: "local" | "remote" | "unknown";
  modalities?: Array<"text" | "image" | "audio" | "document">;
}

export interface OperationTrace {
  traceId: TraceId;
  operation: string;
  startedAt: number;
  status: "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
}
