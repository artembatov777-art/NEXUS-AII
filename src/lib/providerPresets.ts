export interface ProviderPreset {
  id: "gemini" | "groq" | "nvidia";
  label: string;
  baseUrl: string;
  protocol: "openai-chat-completions";
}

/**
 * NEXUS keeps a deliberately small hosted-provider set:
 * Gemini, Groq and NVIDIA. Local Ollama remains a separate no-key option.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", protocol: "openai-chat-completions" },
  { id: "groq", label: "Groq (free tier)", baseUrl: "https://api.groq.com/openai/v1", protocol: "openai-chat-completions" },
  { id: "nvidia", label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", protocol: "openai-chat-completions" }
] as const;

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find(preset => preset.id === id);
}
