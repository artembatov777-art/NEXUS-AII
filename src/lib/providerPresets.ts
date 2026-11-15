export interface ProviderPreset {
  id: "openai" | "gemini" | "deepseek" | "mistral" | "xai" | "anthropic";
  label: string;
  baseUrl: string;
  protocol: "openai-chat-completions" | "anthropic-messages";
}

/**
 * Presets declare their wire protocol explicitly. They configure endpoints only;
 * they never create network traffic or claim that a key/model is valid.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai-chat-completions" },
  { id: "gemini", label: "Google Gemini API", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", protocol: "openai-chat-completions" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-chat-completions" },
  { id: "mistral", label: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", protocol: "openai-chat-completions" },
  { id: "xai", label: "xAI / Grok", baseUrl: "https://api.x.ai", protocol: "openai-chat-completions" },
  { id: "anthropic", label: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", protocol: "anthropic-messages" }
] as const;

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(preset => preset.id === id);
}
