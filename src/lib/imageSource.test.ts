import { describe, expect, it } from "vitest";
import { encodeImageSourceFile } from "./imageSource";

function sourceFile(type: string, bytes: number[], reportedSize = bytes.length) {
  const copy = Uint8Array.from(bytes);
  return {
    type,
    size: reportedSize,
    arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)
  };
}

describe("encodeImageSourceFile", () => {
  it("encodes a signature-checked PNG and preserves its byte length", async () => {
    const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3];
    const result = await encodeImageSourceFile(sourceFile("image/png", bytes));
    expect(result).toEqual({
      mimeType: "image/png",
      data: btoa(String.fromCharCode(...bytes)),
      byteLength: bytes.length
    });
  });

  it("accepts JPEG and WebP signatures", async () => {
    await expect(encodeImageSourceFile(sourceFile("image/jpeg", [255, 216, 255, 0])))
      .resolves.toMatchObject({ mimeType: "image/jpeg", byteLength: 4 });
    await expect(encodeImageSourceFile(sourceFile("image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])))
      .resolves.toMatchObject({ mimeType: "image/webp", byteLength: 12 });
  });

  it("rejects unsupported MIME types and mismatched signatures", async () => {
    await expect(encodeImageSourceFile(sourceFile("image/gif", [71, 73, 70, 56])))
      .rejects.toThrow("Choose a PNG, JPEG, or WebP image.");
    await expect(encodeImageSourceFile(sourceFile("image/png", [1, 2, 3, 4, 5, 6, 7, 8])))
      .rejects.toThrow("do not match");
  });

  it("rejects empty, oversized, and inconsistent files before upload", async () => {
    await expect(encodeImageSourceFile(sourceFile("image/png", [])))
      .rejects.toThrow("between 1 byte and 3.2 MB");
    await expect(encodeImageSourceFile(sourceFile("image/png", [137, 80, 78, 71, 13, 10, 26, 10], 9)))
      .rejects.toThrow("changed while it was being read");
    await expect(encodeImageSourceFile({
      type: "image/png",
      size: 3_200_001,
      arrayBuffer: async () => new ArrayBuffer(0)
    })).rejects.toThrow("between 1 byte and 3.2 MB");
  });
});
