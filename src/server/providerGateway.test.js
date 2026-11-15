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

function createRequest({ provider = "openai", method = "POST", headers = {}, body = {} } = {}) {
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
    vi.stubEnv("OPENAI_API_KEY", "server-side-openai-key");
    vi.stubEnv("XAI_API_KEY", "server-side-xai-key");
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

  it("rejects unknown provider IDs without contacting an upstream host", async () => {
    const response = createResponse();
    await handler(createRequest({ provider: "attacker-controlled-host" }), response);
    expect(response.statusCode).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a missing server-side provider key without exposing configuration", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const response = createResponse();
    await handler(createRequest({ provider: "deepseek", body: { action: "models" } }), response);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("DEEPSEEK_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads model IDs from the allowlisted provider endpoint", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "gpt-test" }, { id: "gpt-test" }, { id: "gpt-next" }, { id: "bad\nid" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = createResponse();
    await handler(createRequest({ body: { action: "models" } }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json().models).toEqual(["gpt-test", "gpt-next"]);
    const [url, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(options.headers.Authorization).toBe("Bearer server-side-openai-key");
  });

  it("proxies chat completions while keeping the provider key out of the browser response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "NEXUS_OK" } }],
      usage: { prompt_tokens: 11, completion_tokens: 4 }
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const response = createResponse();
    await handler(createRequest({
      provider: "xai",
      body: {
        action: "chat",
        model: "grok-test",
        messages: [{ role: "system", content: "Be concise." }, { role: "user", content: "Reply NEXUS_OK." }],
        temperature: 0.1,
        maxOutputTokens: 32
      }
    }), response);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      text: "NEXUS_OK",
      usage: { inputTokens: 11, outputTokens: 4 },
      model: "grok-test"
    });
    const [url, options] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer server-side-xai-key");
    expect(options.body).toContain('"max_tokens":32');
    expect(response.body).not.toContain("server-side-xai-key");
    expect(options.body).not.toContain("server-side-xai-key");
  });

  it("rejects malformed messages before upstream execution", async () => {
    const response = createResponse();
    await handler(createRequest({
      body: { action: "chat", model: "gpt-test", messages: [{ role: "system", content: "Only system." }] }
    }), response);
    expect(response.statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not return upstream diagnostics or secrets", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("server-side-openai-key upstream diagnostic", { status: 500 }));
    const response = createResponse();
    await handler(createRequest({
      body: { action: "chat", model: "gpt-test", messages: [{ role: "user", content: "Hi" }] }
    }), response);
    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("upstream diagnostic");
    expect(response.body).not.toContain("server-side-openai-key");
  });
});
