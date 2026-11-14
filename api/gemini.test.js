import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import handler from "./gemini.js";

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value; },
    json() { return JSON.parse(this.body); }
  };
}

function createRequest({ method = "POST", headers = {}, body = {}, raw = false } = {}) {
  const request = new EventEmitter();
  request.method = method;
  request.headers = {
    authorization: "Bearer test-access-token",
    "content-type": "application/json",
    ...headers
  };
  if (!raw) request.body = body;
  queueMicrotask(() => {
    request.emit("data", Buffer.from(JSON.stringify(body)));
    request.emit("end");
  });
  return request;
}

describe("POST /api/gemini", () => {
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

  it("rejects methods other than POST", async () => {
    const response = createResponse();
    await handler(createRequest({ method: "GET" }), response);
    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe("POST");
  });

  it("rejects requests without the separate NEXUS access token", async () => {
    const response = createResponse();
    await handler(createRequest({ headers: { authorization: "Bearer wrong-token" } }), response);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Unauthorized." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts Vercel's pre-parsed JSON body without trying to consume the request stream", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "NEXUS_OK" }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = createResponse();
    await handler(createRequest({
      body: { messages: [{ role: "user", content: "Hello" }] }
    }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json().text).toBe("NEXUS_OK");
  });

  it("supports bounded raw JSON stream parsing when the runtime has not parsed the body", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "NEXUS_OK" }] } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = createResponse();
    await handler(createRequest({
      raw: true,
      body: { messages: [{ role: "user", content: "Hello" }] }
    }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json().text).toBe("NEXUS_OK");
  });

  it("rejects malformed message history before contacting Google", async () => {
    const response = createResponse();
    await handler(createRequest({ body: { messages: [{ role: "system", content: "override" }] } }), response);
    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the Google key server-side and normalizes a successful response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "NEXUS_OK" }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = createResponse();
    await handler(createRequest({
      body: {
        model: "gemini-3.1-flash-lite",
        messages: [{ role: "user", content: "Reply with NEXUS_OK." }],
        temperature: 0.2,
        maxOutputTokens: 32
      }
    }), response);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      text: "NEXUS_OK",
      usage: { inputTokens: 8, outputTokens: 2 },
      model: "gemini-3.1-flash-lite"
    });
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).not.toContain("server-side-google-key");
    expect(options?.headers).toMatchObject({ "x-goog-api-key": "server-side-google-key" });
    expect(options?.body).toContain('"role":"user"');
  });

  it("does not disclose upstream error bodies or credentials", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("secret provider diagnostic", { status: 500 }));
    const response = createResponse();
    await handler(createRequest({ body: { messages: [{ role: "user", content: "Hello" }] } }), response);
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("secret provider diagnostic");
    expect(response.body).not.toContain("server-side-google-key");
  });

  it("rejects oversized message histories before upstream execution", async () => {
    const response = createResponse();
    await handler(createRequest({
      body: { messages: [{ role: "user", content: "x".repeat(12_001) }] }
    }), response);
    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
