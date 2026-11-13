import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createOllamaProviderProfile, createOmniRouteProviderProfile, createTauriModelRouter, createTauriModelRouterForProfiles, NATIVE_MODEL_PROVIDER_ID } from "./tauriModelProvider";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  Channel: class MockChannel<T> {
    onmessage: ((message: T) => void) | null = null;
  }
}));
const mockedInvoke = vi.mocked(invoke);
const mockedIsTauri = vi.mocked(isTauri);

describe("TauriModelProvider", () => {
  it("discovers models independently across multiple registered provider profiles", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockImplementation((command, args) => {
      if (command !== "list_provider_models") return Promise.resolve(true);
      const baseUrl = (args as { baseUrl: string }).baseUrl;
      return Promise.resolve(baseUrl.includes(":11434") ? ["qwen-local"] : ["cloud-a", "cloud-b"]);
    });
    const router = createTauriModelRouterForProfiles([
      { id: "nexus.ollama", settings: { baseUrl: "http://127.0.0.1:11434/v1", model: "", inferenceLocation: "local", credentialHandle: "none" } },
      { id: "nexus.omniroute", settings: { baseUrl: "https://gateway.example/v1", model: "", inferenceLocation: "remote", credentialHandle: "default" } }
    ]);
    if (!router) throw new Error("Expected native model router.");
    const result = await router.listModels();
    expect(result).toMatchObject({
      ok: true,
      value: [
        { id: "qwen-local", providerId: "nexus.ollama", declaredLocation: "local" },
        { id: "cloud-a", providerId: "nexus.omniroute", declaredLocation: "remote" },
        { id: "cloud-b", providerId: "nexus.omniroute", declaredLocation: "remote" }
      ]
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
  });

  it("prepares Ollama as a loopback-only no-key profile without starting it", () => {
    expect(createOllamaProviderProfile("qwen2.5:7b")).toEqual({
      id: "nexus.ollama",
      settings: {
        baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b",
        inferenceLocation: "local", credentialHandle: "none"
      }
    });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("prepares OmniRoute only from an owner-supplied HTTPS endpoint without connecting", () => {
    expect(createOmniRouteProviderProfile("https://gateway.example/v1", "cloud-model")).toEqual({
      id: "nexus.omniroute",
      settings: {
        baseUrl: "https://gateway.example/v1", model: "cloud-model",
        inferenceLocation: "remote", credentialHandle: "default"
      }
    });
    expect(() => createOmniRouteProviderProfile("http://gateway.example/v1", "cloud-model")).toThrow(/HTTPS/i);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("registers independent compatible provider profiles without connecting them", () => {
    mockedIsTauri.mockReturnValue(true);
    const router = createTauriModelRouterForProfiles([
      { id: "nexus.ollama", settings: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", inferenceLocation: "local", credentialHandle: "none" } },
      { id: "nexus.omniroute", settings: { baseUrl: "https://gateway.example/v1", model: "cloud-model", inferenceLocation: "remote", credentialHandle: "default" } }
    ]);
    expect(router).not.toBeNull();
    expect(router?.getProvider("nexus.ollama").ok).toBe(true);
    expect(router?.getProvider("nexus.omniroute").ok).toBe(true);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects duplicate or invalid provider profile identities before any network request", () => {
    mockedIsTauri.mockReturnValue(true);
    expect(() => createTauriModelRouterForProfiles([
      { id: "nexus.same", settings: { baseUrl: "https://one.example/v1", model: "a", inferenceLocation: "remote" } },
      { id: "nexus.same", settings: { baseUrl: "https://two.example/v1", model: "b", inferenceLocation: "remote" } }
    ])).toThrow(/already registered/i);
    expect(() => createTauriModelRouterForProfiles([
      { id: " ", settings: { baseUrl: "https://one.example/v1", model: "a", inferenceLocation: "remote" } }
    ])).toThrow(/profile ID/i);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  beforeEach(() => { mockedInvoke.mockReset(); mockedIsTauri.mockReset(); });


  it("discovers model catalogs independently for prepared Ollama and OmniRoute profiles", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockImplementation((command, args) => {
      if (command !== "list_provider_models") return Promise.resolve(true);
      const credentialHandle = (args as { credentialHandle: string }).credentialHandle;
      return Promise.resolve(credentialHandle === "none" ? ["qwen-local"] : ["cloud-a", "cloud-b"]);
    });
    const router = createTauriModelRouterForProfiles([
      createOllamaProviderProfile("qwen-local"),
      createOmniRouteProviderProfile("https://gateway.example/v1", "cloud-a")
    ]);
    if (!router) throw new Error("Expected native profile router.");
    const catalog = await router.listModels();
    expect(catalog).toMatchObject({
      ok: true,
      value: [
        { providerId: "nexus.ollama", id: "qwen-local", declaredLocation: "local" },
        { providerId: "nexus.omniroute", id: "cloud-a", declaredLocation: "remote" },
        { providerId: "nexus.omniroute", id: "cloud-b", declaredLocation: "remote" }
      ]
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(2);
    expect(mockedInvoke).toHaveBeenCalledWith("list_provider_models", {
      baseUrl: "http://127.0.0.1:11434/v1", credentialHandle: "none"
    });
    expect(mockedInvoke).toHaveBeenCalledWith("list_provider_models", {
      baseUrl: "https://gateway.example/v1", credentialHandle: "default"
    });
  });

  it("keeps browser preview disconnected from provider credentials", () => {
    mockedIsTauri.mockReturnValue(false);
    expect(createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" })).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects unsafe provider URLs before making a native catalog request", async () => {
    mockedIsTauri.mockReturnValue(true);
    const router = createTauriModelRouter({
      baseUrl: "http://remote.example/v1", model: "model-a", inferenceLocation: "remote"
    });
    if (!router) throw new Error("Expected native model router.");
    await expect(router.listModels()).resolves.toMatchObject({
      ok: false, error: { code: "validation" }
    });
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects configured model IDs containing controls or exceeding the UTF-8 byte limit", async () => {
    mockedIsTauri.mockReturnValue(true);
    for (const model of ["bad" + String.fromCharCode(10) + "model", "я".repeat(65)]) {
      const router = createTauriModelRouter({
        baseUrl: "https://api.example/v1", model, inferenceLocation: "remote"
      });
      if (!router) throw new Error("Expected native model router.");
      await expect(router.listModels()).resolves.toMatchObject({
        ok: false, error: { code: "validation" }
      });
    }
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("retries one transient model catalog request but does not retry generation", async () => {
    mockedIsTauri.mockReturnValue(true);
    vi.useFakeTimers();
    try {
      mockedInvoke
        .mockRejectedValueOnce(new Error("Provider returned HTTP 503: temporary outage"))
        .mockResolvedValueOnce(["model-a"]);
      const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
      if (!router) throw new Error("Expected native model router.");
      const pending = router.listModels();
      await vi.advanceTimersByTimeAsync(250);
      await expect(pending).resolves.toMatchObject({ ok: true });
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes provider discovery authentication failures", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockRejectedValue(new Error("Provider returned HTTP 401: secret=hidden"));
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    await expect(router.listModels()).resolves.toMatchObject({
      ok: false,
      error: { code: "authentication", retryable: false, message: expect.not.stringContaining("hidden") }
    });
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("normalizes transient provider failures during streaming", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockImplementation(command => {
      if (command === "send_chat_stream") return Promise.reject(new Error("Provider returned HTTP 503: backend unavailable"));
      return Promise.resolve(true);
    });
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "user", content: "plan" }]
    });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })())
      .rejects.toThrow(/temporarily unavailable/i);
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "send_chat_stream")).toHaveLength(1);
  });

  it("routes planner requests through the native credential handle without returning secrets", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockImplementation((command, args) => {
      if (command === "list_provider_models") return Promise.resolve(["model-a"]);
      if (command === "send_chat_stream") {
        const channel = (args as { onEvent: { onmessage: (event: { type: "text_delta"; text: string } | { type: "usage"; inputTokens: number; outputTokens: number } | { type: "completed"; finishReason: string }) => void } }).onEvent;
        channel.onmessage({ type: "text_delta", text: JSON.stringify({ goal: "safe" }) });
        channel.onmessage({ type: "usage", inputTokens: 12, outputTokens: 5 });
        channel.onmessage({ type: "completed", finishReason: "stop" });
        return Promise.resolve();
      }
      return Promise.resolve(true);
    });
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    expect(router).not.toBeNull();
    if (!router) throw new Error("Expected native model router.");
    expect(await router.listModels()).toMatchObject({ ok: true, value: [{ providerId: NATIVE_MODEL_PROVIDER_ID, id: "model-a", supportsStreaming: true, declaredLocation: "remote" }] });
    const events = [];
    for await (const event of router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "user", content: "plan" }], temperature: 0.4, maxOutputTokens: 128
    })) events.push(event);
    expect(events.map(event => event.type)).toEqual(["text_delta", "usage", "completed"]);
    expect(events[1]).toMatchObject({ type: "usage", inputTokens: 12, outputTokens: 5 });
    expect(mockedInvoke).toHaveBeenCalledWith("send_chat_stream", expect.objectContaining({
      baseUrl: "https://api.example/v1", credentialHandle: "default", model: "model-a",
      messages: [{ role: "user", content: "plan" }],
      temperature: 0.4, maxOutputTokens: 128,
      streamId: expect.any(String),
      onEvent: expect.any(Object)
    }));
    expect(JSON.stringify(events)).not.toContain("api_key");
  });

  it("discovers only provider-returned model IDs before any model is selected", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue(["model-a", "model-b", "model-a", "", "bad" + String.fromCharCode(10) + "model"]);
    const router = createTauriModelRouter({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "",
      inferenceLocation: "local",
      credentialHandle: "none"
    });
    if (!router) throw new Error("Expected native model router.");
    await expect(router.listModels()).resolves.toMatchObject({
      ok: true,
      value: [{ id: "model-a" }, { id: "model-b" }]
    });
  });

  it("reports the owner-declared inference location rather than the gateway host", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue(["model-a"]);
    const router = createTauriModelRouter({
      baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b",
      inferenceLocation: "local", credentialHandle: "none"
    });
    if (!router) throw new Error("Expected native model router.");
    expect(await router.listModels()).toMatchObject({
      ok: true,
      value: [
        { id: "model-a", declaredLocation: "local" }
      ]
    });
    expect(mockedInvoke).toHaveBeenCalledWith("list_provider_models", {
      baseUrl: "http://127.0.0.1:11434/v1",
      credentialHandle: "none"
    });
  });

  it("sends a native cancellation command when an active stream is aborted", async () => {
    mockedIsTauri.mockReturnValue(true);
    let rejectStream: ((reason?: unknown) => void) | null = null;
    mockedInvoke.mockImplementation((command) => {
      if (command === "send_chat_stream") {
        return new Promise((_resolve, reject) => { rejectStream = reject; });
      }
      if (command === "cancel_chat_stream") {
        rejectStream?.(new Error("Model request was cancelled."));
        return Promise.resolve(true);
      }
      return Promise.resolve([]);
    });
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const controller = new AbortController();
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, { model: "model-a", messages: [{ role: "user", content: "plan" }], signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(mockedInvoke).toHaveBeenCalledWith("cancel_chat_stream", expect.objectContaining({ streamId: expect.any(String) }));
  });

  it("cancels the native request when a consumer stops reading the stream", async () => {
    mockedIsTauri.mockReturnValue(true);
    let rejectStream: ((reason?: unknown) => void) | null = null;
    mockedInvoke.mockImplementation((command, args) => {
      if (command === "send_chat_stream") {
        const channel = (args as { onEvent: { onmessage: (event: { type: "text_delta"; text: string }) => void } }).onEvent;
        return new Promise((_resolve, reject) => {
          rejectStream = reject;
          channel.onmessage({ type: "text_delta", text: "partial" });
        });
      }
      if (command === "cancel_chat_stream") {
        rejectStream?.(new Error("Model request was cancelled."));
        return Promise.resolve(true);
      }
      return Promise.resolve([]);
    });
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const iterator = router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "user", content: "plan" }]
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { type: "text_delta", text: "partial" } });
    await iterator.return?.();
    expect(mockedInvoke).toHaveBeenCalledWith("cancel_chat_stream", expect.objectContaining({ streamId: expect.any(String) }));
  });

  it("rejects tool-role messages until the native payload supports tool call IDs", async () => {
    mockedIsTauri.mockReturnValue(true);
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "tool", content: "tool output" }]
    });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })()).rejects.toThrow(/tool-role messages/i);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects cancellation before making a native request", async () => {
    mockedIsTauri.mockReturnValue(true);
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const controller = new AbortController(); controller.abort();
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, { model: "model-a", messages: [{ role: "user", content: "plan" }], signal: controller.signal });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })()).rejects.toThrow(/cancelled/);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("rejects a native stream that resolves without a completion event", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue(undefined);
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "user", content: "plan" }]
    });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })())
      .rejects.toThrow(/without a completion event/i);
    expect(mockedInvoke).not.toHaveBeenCalledWith("cancel_chat_stream", expect.anything());
  });

  it("does not enqueue cancellation for a native request that already failed", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockRejectedValue(new Error("Provider returned HTTP 503: unavailable"));
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "user", content: "plan" }]
    });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })())
      .rejects.toThrow(/temporarily unavailable/i);
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).not.toHaveBeenCalledWith("cancel_chat_stream", expect.anything());
  });

  it("unblocks an idle stream immediately when its abort signal fires", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockImplementation((command) => {
      if (command === "send_chat_stream") return new Promise(() => { /* native request remains pending */ });
      if (command === "cancel_chat_stream") return Promise.resolve(true);
      return Promise.resolve([]);
    });
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const controller = new AbortController();
    const iterator = router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "user", content: "plan" }], signal: controller.signal
    })[Symbol.asyncIterator]();
    const pending = iterator.next();
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(mockedInvoke).toHaveBeenCalledWith("cancel_chat_stream", expect.objectContaining({ streamId: expect.any(String) }));
  });
});
