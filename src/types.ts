export type Role = "user" | "assistant";
export interface ChatSourceReference {
  documentId: string;
  sourceLabel: string;
  page?: number;
  section?: string;
  chunkId: string;
}
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  sourceReferences?: ChatSourceReference[];
}
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}
export interface ProviderSettings {
  baseUrl: string;
  model: string;
}
export const DEFAULT_PROVIDER: ProviderSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini"
};