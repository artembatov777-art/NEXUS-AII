import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/provider/[provider].js";

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

function createRequest({ provider = "gemini", method = "POST", headers = {}, body = {} } = {}) {
  return {
    method,
    query: { provider },
    headers: {
      authorization: "Bearer test-access-token",
      "content-type": "application/json",
      ...headers
    },
    body
  };
}

describe("hosted provider gateway", () => {
  beforeEach(() => {
    vi.stubEnv("NEXUS_API_TOKEN", "test-access-token");
    vi.stubEnv("GEMINI_API_KEY", "server-side-gemini-key");
    vi.stubEnv("GROQ_API_KEY", "server-side-groq-key");
    vi.stubEnv("NVIDIA_API_KEY", "server-side-nvidia-key");
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects non-POST methods", async () => {
    const response = createResponse();
    await handler(createRequest({ method: "GET" }), response);
    expect(response.statusCode).toBe(405);
    expect(response.headers.Allow).toBe("POST");
  });

  it("requires the separate NEXUS access token", async () => {
    const response = createResponse();
    await handler(createRequest({ headers: { authorization: "Bearer wrong-token" } }), response);
    expect(response.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects removed providers without contacting an upstream host", async () => {
    for (const provider of ["openai", "xai", "mistral", "anthropic", "openrouter", "deepseek", "sambanova", "omniroute"]) {
      const response = createResponse();
      await handler(createRequest({ provider }), response);
      expect(response.statusCode).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a missing server-side provider key without exposing configuration", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const response = createResponse();
    await handler(createRequest({ provider: "groq", body: { action: "models" } }), response);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("GROQ_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes Gemini model discovery through the OpenAI-compatible Google endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gemini-test" }] }), {
      status: 200, headers: { "Content-Type": "application/json" }
    }));
    const response = createResponse();
    await handler(createRequest({ provider: "gemini", body: { action: "models" } }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: "gemini", models: ["gemini-test"] });
    const [url, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
    expect(options.headers.Authorization).toBe("Bearer server-side-gemini-key");
  });

  it("routes Groq chat through the shared secured gateway", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "GROQ_OK" } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = createResponse();
    await handler(createRequest({
      provider: "groq",
      body: { action: "chat", model: "openai/gpt-oss-20b", messages: [{ role: "user", content: "Hello" }] }
    }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json().text).toBe("GROQ_OK");
    const [url, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer server-side-groq-key");
    expect(response.body).not.toContain("server-side-groq-key");
  });

  it("routes NVIDIA chat through the shared secured gateway", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "NVIDIA_OK" } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = createResponse();
    await handler(createRequest({
      provider: "nvidia",
      body: { action: "chat", model: "nvidia-test", messages: [{ role: "user", content: "Hello" }] }
    }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json().text).toBe("NVIDIA_OK");
    const [url, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer server-side-nvidia-key");
  });

  it("rejects malformed messages before upstream execution", async () => {
    const response = createResponse();
    await handler(createRequest({
      body: { action: "chat", model: "gemini-test", messages: [{ role: "system", content: "Only system." }] }
    }), response);
    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the provider's model rejection reason for Gemini generation failures", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 400,
        message: "Model gemini-2.5-flash is not available for this API version."
      }
    }), { status: 400, headers: { "Content-Type": "application/json" } }));
    const response = createResponse();
    await handler(createRequest({
      body: { action: "chat", model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }] }
    }), response);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      provider: "gemini",
      upstreamStatus: 400
    });
    expect(response.json().error).toContain("gemini-2.5-flash");
    expect(response.json().error).toContain("not available for this API version");
  });

  it("returns sanitized upstream diagnostics without exposing provider secrets", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("server-side-gemini-key upstream diagnostic", { status: 500 }));
    const response = createResponse();
    await handler(createRequest({
      body: { action: "chat", model: "gemini-test", messages: [{ role: "user", content: "Hi" }] }
    }), response);
    expect(response.statusCode).toBe(502);
    expect(response.body).toContain("upstream diagnostic");
    expect(response.body).not.toContain("server-side-gemini-key");
  });
});
