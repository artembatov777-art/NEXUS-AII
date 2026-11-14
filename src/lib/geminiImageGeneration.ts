export type ImageAspectRatio = "1:1" | "3:2" | "2:3" | "4:3" | "3:4" | "5:4" | "4:5" | "16:9" | "9:16" | "21:9";
export type ImageSize = "1K" | "2K";

export interface GeneratedImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  data: string;
  byteLength: number;
  text: string;
  model: string;
  aspectRatio: ImageAspectRatio;
  imageSize: ImageSize;
}

export async function generateGeminiImage(
  prompt: string,
  accessToken: string,
  options: { aspectRatio?: ImageAspectRatio; imageSize?: ImageSize; remoteConsent?: boolean; signal?: AbortSignal } = {}
): Promise<GeneratedImage> {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt || normalizedPrompt.length > 2_000) {
    throw new Error("Prompt must contain 1 to 2,000 characters.");
  }
  if (!accessToken.trim()) throw new Error("Enter the NEXUS access token in provider settings first.");
  if (options.remoteConsent !== true) throw new Error("Explicit approval for remote image processing is required.");
  const aspectRatio = options.aspectRatio ?? "1:1";
  const imageSize = options.imageSize ?? "1K";

  const response = await fetch("/api/gemini-image", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken.trim()}`
    },
    body: JSON.stringify({ prompt: normalizedPrompt, aspectRatio, imageSize, allowRemoteProcessing: true }),
    signal: options.signal
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Image service returned an invalid response (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Image generation failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object" || !("image" in payload)) {
    throw new Error("Image service returned an incomplete response.");
  }
  const result = payload as {
    image?: { mimeType?: string; data?: string; byteLength?: number };
    text?: string;
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
  };
  const image = result.image;
  if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType ?? "") ||
      typeof image.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) ||
      !Number.isSafeInteger(image.byteLength) || (image.byteLength ?? 0) <= 0 || (image.byteLength ?? 0) > 3_200_000 ||
      image.data.length > 4_300_000) {
    throw new Error("Image service returned an invalid or oversized image.");
  }
  return {
    mimeType: image.mimeType as GeneratedImage["mimeType"],
    data: image.data,
    byteLength: image.byteLength!,
    text: typeof result.text === "string" ? result.text : "",
    model: typeof result.model === "string" ? result.model : "unknown",
    aspectRatio,
    imageSize
  };
}
