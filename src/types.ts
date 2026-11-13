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
  /** Workspace owner; absent means the personal, unassigned workspace. */
  projectId?: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}
export interface ProviderSettings {
  baseUrl: string;
  model: string;
  /** Owner-declared model location; OmniRoute backend locality is not independently verified. */
  inferenceLocation: "local" | "remote";
  /** "none" is accepted only by the native host for loopback runtimes such as Ollama. */
  credentialHandle?: "default" | "ollama" | "none";
}
export const DEFAULT_PROVIDER: ProviderSettings = {
  baseUrl: "http://127.0.0.1:20128/v1",
  model: "auto",
  inferenceLocation: "remote"
};