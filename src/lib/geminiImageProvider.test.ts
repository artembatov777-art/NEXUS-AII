import { describe, expect, it, vi } from "vitest";
import { createGeminiImageProvider } from "./geminiImageProvider";
import { generateGeminiImage } from "./geminiImageGeneration";

vi.mock("./geminiImageGeneration", () => ({ generateGeminiImage: vi.fn() }));

describe("createGeminiImageProvider", () => {
  it("declares explicit remote image-generation capabilities", () => {
    const provider = createGeminiImageProvider("token");
    expect(provider.capabilities).toMatchObject({
      id: "gemini-image",
      modelId: "gemini-3.1-flash-image",
      location: "remote",
      requiresRemoteConsent: true
    });
    expect(provider.capabilities.aspectRatios).toContain("16:9");
  });

  it("passes the owner's consent and cancellation signal to the Gemini adapter", async () => {
    const image = {
      mimeType: "image/png" as const, data: "iVBORw0KGgo=", byteLength: 8,
      text: "", model: "gemini-3.1-flash-image", aspectRatio: "1:1" as const, imageSize: "1K" as const
    };
    vi.mocked(generateGeminiImage).mockResolvedValue(image);
    const controller = new AbortController();
    const result = await createGeminiImageProvider("token").generate({
      prompt: "A lake", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: true
    }, controller.signal);
    expect(result).toMatchObject({ ok: true, value: image });
    expect(generateGeminiImage).toHaveBeenCalledWith("A lake", "token", {
      aspectRatio: "1:1", imageSize: "1K", remoteConsent: true, useGatewayCookie: false, signal: controller.signal
    });
  });

  it("normalizes provider errors without claiming success", async () => {
    vi.mocked(generateGeminiImage).mockRejectedValue(new Error("Gemini unavailable."));
    const result = await createGeminiImageProvider("token").generate({
      prompt: "A lake", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: true
    });
    expect(result).toMatchObject({ ok: false, error: { code: "provider_unavailable", message: "Gemini unavailable." } });
  });
});
