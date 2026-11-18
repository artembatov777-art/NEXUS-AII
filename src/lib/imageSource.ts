import type { GeneratedImage } from "../core/imageGeneration";

export type SourceImage = Pick<GeneratedImage, "mimeType" | "data" | "byteLength">;
export const MAX_SOURCE_IMAGE_BYTES = 3_200_000;

const MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export async function encodeImageSourceFile(
  file: Pick<File, "type" | "size" | "arrayBuffer">
): Promise<SourceImage> {
  if (!file || !MIME_TYPES.includes(file.type as (typeof MIME_TYPES)[number])) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Source images must be between 1 byte and 3.2 MB.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error("Could not read the selected image.");
  }
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("The selected image changed while it was being read or exceeds 3.2 MB.");
  }

  const validSignature = file.type === "image/png"
    ? bytes.length >= 8 && bytes.subarray(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])
    : file.type === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!validSignature) {
    throw new Error("The image contents do not match the selected PNG, JPEG, or WebP file type.");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return {
    mimeType: file.type as SourceImage["mimeType"],
    data: btoa(binary),
    byteLength: bytes.byteLength
  };
}
