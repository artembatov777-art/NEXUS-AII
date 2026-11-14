import { err, ok, type Result } from "../core/result";
import type { ImageGenerationProvider, ImageGenerationRequest, GeneratedImage } from "../core/imageGeneration";
import { generateGeminiImage } from "./geminiImageGeneration";

const ASPECT_RATIOS: ImageGenerationProvider["capabilities"]["aspectRatios"] = [
  "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"
];

export function createGeminiImageProvider(accessToken: string): ImageGenerationProvider {
  return {
    capabilities: {
      id: "gemini-image",
      displayName: "Google Gemini 3.1 Flash Image",
      modelId: "gemini-3.1-flash-image",
      location: "remote",
      aspectRatios: ASPECT_RATIOS,
      imageSizes: ["1K", "2K"],
      requiresRemoteConsent: true
    },
    async generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<Result<GeneratedImage>> {
      try {
        const image = await generateGeminiImage(request.prompt, accessToken, {
          aspectRatio: request.aspectRatio,
          imageSize: request.imageSize,
          remoteConsent: request.allowRemoteProcessing,
          signal
        });
        return ok(image);
      } catch (cause) {
        return err("provider_unavailable", cause instanceof Error ? cause.message : "Gemini image generation failed.");
      }
    }
  };
}
