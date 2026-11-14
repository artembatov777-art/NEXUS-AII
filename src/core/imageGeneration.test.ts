import { describe, expect, it, vi } from "vitest";
import { err, ok } from "./result";
import { ImageGenerationRouter, type ImageGenerationProvider, type ImageGenerationRequest, type GeneratedImage } from "./imageGeneration";

const capabilities = {
  id: "test-image",
  displayName: "Test image provider",
  modelId: "test-image-v1",
  location: "remote" as const,
  aspectRatios: ["1:1", "16:9"] as const,
  imageSizes: ["1K"] as const,
  requiresRemoteConsent: true
};
const output = {
  mimeType: "image/png" as const,
  data: "iVBORw0KGgo=",
  byteLength: 8,
  text: "Generated",
  model: "test-image-v1",
  aspectRatio: "1:1" as const,
  imageSize: "1K" as const
};
const provider = (generate: ImageGenerationProvider["generate"] = async () => ok(output)): ImageGenerationProvider => ({
  capabilities: { ...capabilities, aspectRatios: [...capabilities.aspectRatios], imageSizes: [...capabilities.imageSizes] },
  generate
});

describe("ImageGenerationRouter", () => {
  it("registers providers and returns cloned capability declarations", () => {
    const router = new ImageGenerationRouter();
    expect(router.register(provider()).ok).toBe(true);
    const listed = router.listCapabilities();
    listed[0]!.aspectRatios.push("9:16");
    expect(router.listCapabilities()[0]?.aspectRatios).toEqual(["1:1", "16:9"]);
    expect(router.register(provider()).ok).toBe(false);
  });

  it("requires explicit remote consent before provider execution", async () => {
    const generate = vi.fn(async () => ok(output));
    const router = new ImageGenerationRouter();
    router.register(provider(generate));
    const result = await router.generate("test-image", {
      prompt: "A quiet lake", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: false
    });
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(generate).not.toHaveBeenCalled();
  });

  it("routes supported requests and trims prompts", async () => {
    const generate: ImageGenerationProvider["generate"] = vi.fn(async (request: ImageGenerationRequest) => ok({ ...output, aspectRatio: request.aspectRatio, imageSize: request.imageSize }));
    const router = new ImageGenerationRouter();
    router.register(provider(generate));
    const result = await router.generate("test-image", {
      prompt: "  A quiet lake  ", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: true
    });
    expect(result).toMatchObject({ ok: true, value: output });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "A quiet lake" }), undefined);
  });

  it("rejects unknown providers, unsupported options, invalid output, and cancellation", async () => {
    const router = new ImageGenerationRouter();
    const missing = await router.generate("missing", {
      prompt: "A lake", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: true
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
    const generate: ImageGenerationProvider["generate"] = vi.fn(async () => ok({ ...output, mimeType: "image/svg+xml" } as unknown as GeneratedImage));
    router.register(provider(generate));
    const unsupported = await router.generate("test-image", {
      prompt: "A lake", aspectRatio: "9:16", imageSize: "1K", allowRemoteProcessing: true
    });
    expect(unsupported.ok).toBe(false);
    const invalid = await router.generate("test-image", {
      prompt: "A lake", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: true
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await router.generate("test-image", {
      prompt: "A lake", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: true
    }, controller.signal);
    expect(cancelled).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });

  it("returns provider failures without retrying", async () => {
    const router = new ImageGenerationRouter();
    router.register(provider(vi.fn(async () => err("provider_unavailable", "Offline."))));
    const result = await router.generate("test-image", {
      prompt: "A lake", aspectRatio: "1:1", imageSize: "1K", allowRemoteProcessing: true
    });
    expect(result).toMatchObject({ ok: false, error: { message: "Offline." } });
  });
});
