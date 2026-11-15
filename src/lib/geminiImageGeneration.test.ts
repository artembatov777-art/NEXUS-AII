import { afterEach, describe, expect, it, vi } from "vitest";
import { generateGeminiImage } from "./geminiImageGeneration";

afterEach(() => vi.unstubAllGlobals());

describe("generateGeminiImage", () => {
  it("validates the prompt and access token before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateGeminiImage(" ", "token")).rejects.toThrow(/Prompt/);
    await expect(generateGeminiImage("A cat", " ")).rejects.toThrow(/NEXUS gateway/);
    await expect(generateGeminiImage("A cat", "token")).rejects.toThrow(/remote image processing/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends bounded generation options through the authenticated same-origin endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      image: { mimeType: "image/png", data: "iVBORw0KGgo=", byteLength: 8 },
      text: "Generated",
      model: "gemini-3.1-flash-image"
    }), { status: 200 })));
    const result = await generateGeminiImage("  A quiet lake  ", "token", { aspectRatio: "16:9", imageSize: "2K", remoteConsent: true });
    expect(result).toMatchObject({ mimeType: "image/png", byteLength: 8, aspectRatio: "16:9", imageSize: "2K" });
    expect(fetch).toHaveBeenCalledWith("/api/gemini-image", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
      body: JSON.stringify({ prompt: "A quiet lake", aspectRatio: "16:9", imageSize: "2K", allowRemoteProcessing: true })
    }));
  });

  it("uses the remembered HttpOnly session without sending the raw token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      image: { mimeType: "image/png", data: "iVBORw0KGgo=", byteLength: 8 }, text: "Generated", model: "gemini-3.1-flash-image"
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await generateGeminiImage("A cat", "", { remoteConsent: true, useGatewayCookie: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/gemini-image", expect.objectContaining({
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }
    }));
  });

  it("surfaces safe server errors without exposing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Gemini is temporarily unavailable." }), { status: 502 })));
    await expect(generateGeminiImage("A landscape", "secret", { remoteConsent: true })).rejects.toThrow("Gemini is temporarily unavailable.");
  });

  it("rejects malformed or oversized image responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      image: { mimeType: "image/svg+xml", data: "PHN2Zz4=", byteLength: 6 }
    }), { status: 200 })));
    await expect(generateGeminiImage("A landscape", "token", { remoteConsent: true })).rejects.toThrow(/invalid or oversized/);
  });
});
