export type Role = "user" | "assistant";
export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
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