export interface ProviderPreset {
  id: "openai" | "gemini" | "deepseek" | "mistral" | "xai" | "anthropic" |
    "openrouter" | "groq" | "sambanova" | "nvidia" | "omniroute";
  label: string;
  baseUrl: string;
  protocol: "openai-chat-completions" | "anthropic-messages";
}

/**
 * Presets declare their wire protocol explicitly. They configure endpoints only;
 * they never create network traffic or claim that a key/model is valid.
 * Free-tier availability and quotas are controlled by each upstream provider.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai-chat-completions" },
  { id: "gemini", label: "Google Gemini API", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", protocol: "openai-chat-completions" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", protocol: "openai-chat-completions" },
  { id: "mistral", label: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", protocol: "openai-chat-completions" },
  { id: "xai", label: "xAI / Grok", baseUrl: "https://api.x.ai/v1", protocol: "openai-chat-completions" },
  { id: "anthropic", label: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", protocol: "anthropic-messages" },
  { id: "openrouter", label: "OpenRouter (including :free models)", baseUrl: "https://openrouter.ai/api/v1", protocol: "openai-chat-completions" },
  { id: "groq", label: "GroqCloud (free tier)", baseUrl: "https://api.groq.com/openai/v1", protocol: "openai-chat-completions" },
  { id: "sambanova", label: "SambaNova Cloud (free tier)", baseUrl: "https://api.sambanova.ai/v1", protocol: "openai-chat-completions" },
  { id: "nvidia", label: "NVIDIA NIM (developer tier)", baseUrl: "https://integrate.api.nvidia.com/v1", protocol: "openai-chat-completions" },
  { id: "omniroute", label: "OmniRoute (hosted gateway)", baseUrl: "http://localhost:20128/v1", protocol: "openai-chat-completions" }
] as const;

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(preset => preset.id === id);
}
