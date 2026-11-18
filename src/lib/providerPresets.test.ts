import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER } from "../types";
import { getProviderPreset, PROVIDER_PRESETS } from "./providerPresets";

describe("provider presets", () => {
  it("exposes Gemini, Groq and NVIDIA as hosted presets", () => {
    expect(PROVIDER_PRESETS.map(preset => preset.id)).toEqual(["gemini", "groq", "nvidia"]);
    for (const preset of PROVIDER_PRESETS) {
      const url = new URL(preset.baseUrl);
      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(preset.protocol).toBe("openai-chat-completions");
    }
  });

  it("returns supported presets by stable ID and rejects removed providers", () => {
    expect(getProviderPreset("gemini")?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(getProviderPreset("groq")?.baseUrl).toBe("https://api.groq.com/openai/v1");
    expect(getProviderPreset("nvidia")?.baseUrl).toBe("https://integrate.api.nvidia.com/v1");
    for (const removed of ["openai", "xai", "mistral", "anthropic", "openrouter", "deepseek", "sambanova", "omniroute"]) {
      expect(getProviderPreset(removed)).toBeUndefined();
    }
  });

  it("keeps the local default separate from cloud provider presets", () => {
    expect(DEFAULT_PROVIDER.inferenceLocation).toBe("local");
    expect(DEFAULT_PROVIDER.credentialHandle).toBe("none");
  });
});
