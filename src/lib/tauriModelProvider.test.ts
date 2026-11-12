import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createTauriModelRouter, NATIVE_MODEL_PROVIDER_ID } from "./tauriModelProvider";

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
  beforeEach(() => { mockedInvoke.mockReset(); mockedIsTauri.mockReset(); });

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
        { id: "qwen2.5:7b", declaredLocation: "local" },
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

  it("rejects cancellation before making a native request", async () => {
    mockedIsTauri.mockReturnValue(true);
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote" });
    if (!router) throw new Error("Expected native model router.");
    const controller = new AbortController(); controller.abort();
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, { model: "model-a", messages: [{ role: "user", content: "plan" }], signal: controller.signal });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })()).rejects.toThrow(/cancelled/);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
