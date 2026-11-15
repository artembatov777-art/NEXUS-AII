import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER } from "../types";
import { getProviderPreset, PROVIDER_PRESETS } from "./providerPresets";

describe("provider presets", () => {
  it("contains only known OpenAI Chat Completions-compatible endpoints", () => {
    expect(PROVIDER_PRESETS.map(preset => preset.id)).toEqual(["openai", "gemini", "deepseek", "mistral", "xai", "anthropic"]);
    for (const preset of PROVIDER_PRESETS) {
      const url = new URL(preset.baseUrl);
      expect(url.protocol).toBe("https:");
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(preset.protocol).toBe("openai-chat-completions");
    }
  });

  it("returns a preset by stable ID and rejects unknown providers", () => {
    expect(getProviderPreset("deepseek")?.baseUrl).toBe("https://api.deepseek.com");
    expect(getProviderPreset("anthropic")).toBeUndefined();
  });

  it("keeps the local default separate from cloud provider presets", () => {
    expect(DEFAULT_PROVIDER.inferenceLocation).toBe("local");
    expect(DEFAULT_PROVIDER.credentialHandle).toBe("none");
  });
});
