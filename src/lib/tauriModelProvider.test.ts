import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { createTauriModelRouter, NATIVE_MODEL_PROVIDER_ID } from "./tauriModelProvider";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);
const mockedIsTauri = vi.mocked(isTauri);

describe("TauriModelProvider", () => {
  beforeEach(() => { mockedInvoke.mockReset(); mockedIsTauri.mockReset(); });

  it("keeps browser preview disconnected from provider credentials", () => {
    mockedIsTauri.mockReturnValue(false);
    expect(createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a" })).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("routes planner requests through the native credential handle without returning secrets", async () => {
    mockedIsTauri.mockReturnValue(true);
    mockedInvoke.mockResolvedValue(" {\"goal\":\"safe\"} ");
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a" });
    expect(router).not.toBeNull();
    if (!router) throw new Error("Expected native model router.");
    expect(await router.listModels()).toMatchObject({ ok: true, value: [{ providerId: NATIVE_MODEL_PROVIDER_ID, id: "model-a", supportsStreaming: false }] });
    const events = [];
    for await (const event of router.stream(NATIVE_MODEL_PROVIDER_ID, {
      model: "model-a", messages: [{ role: "user", content: "plan" }]
    })) events.push(event);
    expect(events.map(event => event.type)).toEqual(["text_delta", "completed"]);
    expect(mockedInvoke).toHaveBeenCalledWith("send_chat", {
      baseUrl: "https://api.example/v1", credentialHandle: "default", model: "model-a",
      messages: [{ role: "user", content: "plan" }]
    });
    expect(JSON.stringify(events)).not.toContain("api_key");
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
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a" });
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

  it("rejects cancellation before making a native request", async () => {
    mockedIsTauri.mockReturnValue(true);
    const router = createTauriModelRouter({ baseUrl: "https://api.example/v1", model: "model-a" });
    if (!router) throw new Error("Expected native model router.");
    const controller = new AbortController(); controller.abort();
    const stream = router.stream(NATIVE_MODEL_PROVIDER_ID, { model: "model-a", messages: [{ role: "user", content: "plan" }], signal: controller.signal });
    await expect((async () => { for await (const _ of stream) { /* consume */ } })()).rejects.toThrow(/cancelled/);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
