import { describe, expect, it } from "vitest";
import { canUseAgentProvider } from "./agentProviderAvailability";

describe("agent provider availability", () => {
  it("allows an explicitly credential-free local provider", () => {
    expect(canUseAgentProvider({
      baseUrl: "http://127.0.0.1:11434/v1", model: "qwen-local",
      inferenceLocation: "local", credentialHandle: "none"
    }, false)).toBe(true);
  });

  it("requires a stored key for cloud profiles", () => {
    expect(canUseAgentProvider({
      baseUrl: "https://gateway.example/v1", model: "cloud-model",
      inferenceLocation: "remote", credentialHandle: "default"
    }, false)).toBe(false);
    expect(canUseAgentProvider({
      baseUrl: "https://gateway.example/v1", model: "cloud-model",
      inferenceLocation: "remote", credentialHandle: "default"
    }, true)).toBe(true);
  });

  it("does not infer credential-free mode from a loopback URL", () => {
    expect(canUseAgentProvider({
      baseUrl: "http://127.0.0.1:11434/v1", model: "qwen-local",
      inferenceLocation: "local", credentialHandle: "default"
    }, false)).toBe(false);
  });
});
