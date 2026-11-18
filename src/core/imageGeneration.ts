import { err, ok, type Result } from "./result";

export type ImageAspectRatio = "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5" | "16:9" | "9:16" | "21:9";
export type ImageSize = "1K" | "2K";
export type GeneratedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageGenerationRequest {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  imageSize: ImageSize;
  allowRemoteProcessing: boolean;
  /** Existing generated image to use as the visual source for an edit. */
  sourceImage?: Pick<GeneratedImage, "mimeType" | "data" | "byteLength">;
}

export interface GeneratedImage {
  mimeType: GeneratedImageMimeType;
  data: string;
  byteLength: number;
  text: string;
  model: string;
  aspectRatio: ImageAspectRatio;
  imageSize: ImageSize;
}

export interface ImageGenerationCapabilities {
  id: string;
  displayName: string;
  modelId: string;
  location: "local" | "remote";
  aspectRatios: ImageAspectRatio[];
  imageSizes: ImageSize[];
  requiresRemoteConsent: boolean;
}

export interface ImageGenerationProvider {
  capabilities: ImageGenerationCapabilities;
  generate(request: ImageGenerationRequest, signal?: AbortSignal): Promise<Result<GeneratedImage>>;
}

/** Routes image-generation work by declared capabilities, never by guessing from a chat model ID. */
export class ImageGenerationRouter {
  private readonly providers = new Map<string, ImageGenerationProvider>();

  register(provider: ImageGenerationProvider): Result<void> {
    const capabilities = provider?.capabilities;
    if (!capabilities || !validId(capabilities.id) || !validId(capabilities.displayName) ||
        !validId(capabilities.modelId) || !["local", "remote"].includes(capabilities.location) ||
        typeof capabilities.requiresRemoteConsent !== "boolean" ||
        !Array.isArray(capabilities.aspectRatios) || capabilities.aspectRatios.length === 0 ||
        capabilities.aspectRatios.some(value => !ASPECT_RATIOS.includes(value)) ||
        new Set(capabilities.aspectRatios).size !== capabilities.aspectRatios.length ||
        !Array.isArray(capabilities.imageSizes) || capabilities.imageSizes.length === 0 ||
        capabilities.imageSizes.some(value => !IMAGE_SIZES.includes(value)) ||
        new Set(capabilities.imageSizes).size !== capabilities.imageSizes.length ||
        typeof provider.generate !== "function") {
      return err("validation", "Image-generation provider capabilities are invalid.");
    }
    if (this.providers.has(capabilities.id)) return err("validation", "An image-generation provider with this ID is already registered.");
    this.providers.set(capabilities.id, {
      ...provider,
      capabilities: {
        ...capabilities,
        aspectRatios: [...capabilities.aspectRatios],
        imageSizes: [...capabilities.imageSizes]
      }
    });
    return ok(undefined);
  }

  listCapabilities(): ImageGenerationCapabilities[] {
    return [...this.providers.values()].map(provider => ({
      ...provider.capabilities,
      aspectRatios: [...provider.capabilities.aspectRatios],
      imageSizes: [...provider.capabilities.imageSizes]
    }));
  }

  async generate(providerId: string, request: ImageGenerationRequest, signal?: AbortSignal): Promise<Result<GeneratedImage>> {
    if (!validId(providerId) || !request || typeof request !== "object" ||
        typeof request.prompt !== "string" || !request.prompt.trim() || request.prompt.trim().length > 2_000 ||
        !ASPECT_RATIOS.includes(request.aspectRatio) || !IMAGE_SIZES.includes(request.imageSize) ||
        typeof request.allowRemoteProcessing !== "boolean" ||
        (request.sourceImage !== undefined && !isValidSourceImage(request.sourceImage))) {
      return err("validation", "Image-generation request is invalid.");
    }
    const provider = this.providers.get(providerId);
    if (!provider) return err("provider_unavailable", "The selected image-generation provider is not registered.");
    const capabilities = provider.capabilities;
    if (!capabilities.aspectRatios.includes(request.aspectRatio) || !capabilities.imageSizes.includes(request.imageSize)) {
      return err("validation", "The selected provider does not support this image ratio or resolution.");
    }
    if ((capabilities.location === "remote" || capabilities.requiresRemoteConsent) && request.allowRemoteProcessing !== true) {
      return err("permission_denied", "Remote image generation requires explicit consent.");
    }
    if (signal?.aborted) return err("cancelled", "Image generation was cancelled before it started.");
    try {
      const result = await provider.generate({ ...request, prompt: request.prompt.trim() }, signal);
      if (!result.ok) return result;
      if (signal?.aborted) return err("cancelled", "Image generation was cancelled.");
      const image = result.value;
      const padding = typeof image?.data === "string" ? (image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0) : 0;
      const unpaddedData = typeof image?.data === "string" ? image.data.slice(0, image.data.length - padding) : "";
      const validBase64Padding = !unpaddedData.includes("=") &&
        (padding === 0 || (padding === 1 && unpaddedData.length % 4 === 3) || (padding === 2 && unpaddedData.length % 4 === 2));
      const decodedLength = typeof image?.data === "string" && image.data.length % 4 === 0 && validBase64Padding
        ? (image.data.length / 4) * 3 - padding
        : -1;
      if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType) ||
          typeof image.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) ||
          !Number.isSafeInteger(image.byteLength) || image.byteLength <= 0 || image.byteLength > 3_200_000 ||
          image.data.length > 4_300_000 || decodedLength !== image.byteLength ||
          !validId(image.model) || image.model !== capabilities.modelId || typeof image.text !== "string" ||
          image.aspectRatio !== request.aspectRatio || image.imageSize !== request.imageSize) {
        return err("provider_unavailable", "The image provider returned invalid or oversized output.");
      }
      return ok(image);
    } catch {
      return err("provider_unavailable", "The image-generation provider failed unexpectedly.");
    }
  }
}

const ASPECT_RATIOS: ImageAspectRatio[] = ["1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "21:9"];
const IMAGE_SIZES: ImageSize[] = ["1K", "2K"];

function isValidSourceImage(value: unknown): value is ImageGenerationRequest["sourceImage"] {
  if (!value || typeof value !== "object") return false;
  const image = value as { mimeType?: unknown; data?: unknown; byteLength?: unknown };
  if (!["image/png", "image/jpeg", "image/webp"].includes(String(image.mimeType)) ||
      typeof image.data !== "string" || image.data.length > 4_300_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data) ||
      !Number.isSafeInteger(image.byteLength) || Number(image.byteLength) <= 0 || Number(image.byteLength) > 3_200_000) return false;
  const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
  return image.data.length % 4 === 0 && (image.data.length / 4) * 3 - padding === image.byteLength;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);
}
