import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import handler from "../../api/gemini-image.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value; },
    json() { return JSON.parse(this.body); }
  };
}

function request({ method = "POST", headers = {}, body = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {
    authorization: "Bearer test-access-token",
    "content-type": "application/json",
    ...headers
  };
  req.body = body;
  return req;
}

describe("POST /api/gemini-image", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "server-side-google-key");
    vi.stubEnv("NEXUS_API_TOKEN", "test-access-token");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires POST and the separate NEXUS access token", async () => {
    const wrongMethod = response();
    await handler(request({ method: "GET" }), wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);
    const unauthorized = response();
    await handler(request({ headers: { authorization: "Bearer wrong" } }), unauthorized);
    expect(unauthorized.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects empty, oversized, and invalid image options before contacting Google", async () => {
    for (const body of [
      { prompt: "A cat" },
      { prompt: " ", allowRemoteProcessing: true },
      { prompt: "x".repeat(2_001), allowRemoteProcessing: true },
      { prompt: "a cat", aspectRatio: "7:5", allowRemoteProcessing: true },
      { prompt: "a cat", imageSize: "8K", allowRemoteProcessing: true }
    ]) {
      const res = response();
      await handler(request({ body }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the Google API key server-side and returns a verified image payload", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [
        { text: "Generated." },
        { inlineData: { mimeType: "image/png", data: png } }
      ] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const res = response();
    await handler(request({ body: { prompt: "A quiet mountain lake", aspectRatio: "16:9", imageSize: "1K", allowRemoteProcessing: true } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      image: { mimeType: "image/png", data: png, byteLength: 12 },
      text: "Generated.",
      model: "gemini-3.1-flash-image",
      aspectRatio: "16:9",
      imageSize: "1K"
    });
    const [url, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain("gemini-3.1-flash-image:generateContent");
    expect(String(url)).not.toContain("server-side-google-key");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "server-side-google-key" });
    expect(options?.body).toContain('"responseModalities":["TEXT","IMAGE"]');
    expect(options?.body).toContain('"responseFormat":{"image":{"aspectRatio":"16:9","imageSize":"1K"}}');
  });

  it("rejects upstream responses without a valid supported image", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("not an image").toString("base64") } }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const res = response();
    await handler(request({ body: { prompt: "A landscape", allowRemoteProcessing: true } }), res);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "Gemini returned an invalid image payload." });
  });

  it("aborts the upstream request when the browser client disconnects", async () => {
    let upstreamSignal;
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      upstreamSignal = options?.signal as AbortSignal;
      upstreamSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const req = request({ body: { prompt: "A landscape", allowRemoteProcessing: true } });
    const res = response();
    const pending = handler(req, res);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    req.emit("aborted");
    await pending;
    expect(upstreamSignal?.aborted).toBe(true);
    expect(res.body).toBe("");
  });

  it("does not expose upstream error bodies or credentials", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("private upstream details", { status: 500 }));
    const res = response();
    await handler(request({ body: { prompt: "A landscape", allowRemoteProcessing: true } }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("private upstream details");
    expect(res.body).not.toContain("server-side-google-key");
  });
});
