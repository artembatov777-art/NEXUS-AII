export type Role = "user" | "assistant";
export interface ChatSourceReference {
  documentId: string;
  sourceLabel: string;
  page?: number;
  section?: string;
  chunkId: string;
}
export interface ChatImageAttachment {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  model: string;
  aspectRatio: string;
  imageSize: "1K" | "2K";
  byteLength: number;
}
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  sourceReferences?: ChatSourceReference[];
  imageAttachment?: ChatImageAttachment;
}
export interface Conversation {
  id: string;
  /** Workspace owner; absent means the personal, unassigned workspace. */
  projectId?: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}
export interface ProviderSettings {
  baseUrl: string;
  model: string;
  /** Owner-declared processing location; upstream routing is not independently verifiable. */
  inferenceLocation: "local" | "remote";
  /** Shared slots, no-key loopback mode, or a strictly validated per-profile OS-vault handle. */
  credentialHandle?: string;
  /** Wire protocol implemented by the native provider adapter. */
  providerProtocol?: "openai-chat-completions" | "anthropic-messages";
}
export const DEFAULT_PROVIDER: ProviderSettings = {
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "",
  inferenceLocation: "local",
  credentialHandle: "none"
};