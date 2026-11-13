import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "./domain";
import { ModelRegistry, ModelRouter, type ModelEvent, type ModelProvider, type ModelRequest } from "./model";
import { ok } from "./result";

class FakeProvider implements ModelProvider {
  readonly id = "fake";
  async listModels() {
    const models: ModelDescriptor[] = [{
      id: "fake-model",
      providerId: this.id,
      displayName: "Fake Model",
      supportsStreaming: true,
      supportsTools: false
    }];
    return ok(models);
  }
  async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> {
    yield { type: "text_delta", text: "Hello " };
    yield { type: "text_delta", text: "NEXUS" };
    yield { type: "completed", finishReason: "stop" };
  }
}

describe("ModelRouter", () => {
  it("registers providers and lists their models", async () => {
    const router = new ModelRouter();
    expect(router.register(new FakeProvider()).ok).toBe(true);
    const models = await router.listModels();
    expect(models.ok).toBe(true);
    if (models.ok) expect(models.value[0]?.id).toBe("fake-model");
  });


  it("keeps healthy provider models available when another provider catalog fails", async () => {
    class OfflineProvider implements ModelProvider {
      readonly id = "offline";
      async listModels() { return { ok: false as const, error: { code: "provider_unavailable" as const, message: "Offline", retryable: true } }; }
      async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: "completed" }; }
    }
    const router = new ModelRouter();
    router.register(new FakeProvider());
    router.register(new OfflineProvider());
    const registry = new ModelRegistry(router, () => 100);
    const result = await registry.refresh();
    expect(result).toMatchObject({ ok: true, value: [{ id: "fake-model" }] });
    expect(router.getProviderFailures()).toEqual([{
      providerId: "offline", code: "provider_unavailable", message: "Offline", retryable: true
    }]);
    expect(registry.getSnapshot()).toMatchObject({
      state: "ready", modelCount: 1, failedProviders: ["offline"]
    });
  });

  it("reports all provider failures when no catalog is available", async () => {
    class OfflineProvider implements ModelProvider {
      readonly id = "offline";
      async listModels() { throw new Error("Gateway offline"); }
      async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: "completed" }; }
    }
    const router = new ModelRouter();
    router.register(new OfflineProvider());
    const result = await router.listModels();
    expect(result).toMatchObject({ ok: false, error: { code: "provider_unavailable", message: "Gateway offline" } });
    expect(router.getProviderFailures()).toMatchObject([{ providerId: "offline", message: "Gateway offline" }]);
  });


  it("clears a provider's catalog failure when that provider is unregistered", async () => {
    class OfflineProvider implements ModelProvider {
      readonly id = "offline";
      async listModels() { return { ok: false as const, error: { code: "provider_unavailable" as const, message: "Offline", retryable: true } }; }
      async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: "completed" }; }
    }
    const router = new ModelRouter();
    router.register(new FakeProvider());
    router.register(new OfflineProvider());
    await router.listModels();
    expect(router.getProviderFailures()).toHaveLength(1);
    router.unregister("offline");
    expect(router.getProviderFailures()).toEqual([]);
  });

  it("rejects provider IDs with control characters or excessive length", () => {
    const router = new ModelRouter();
    class InvalidProvider extends FakeProvider {
      constructor(readonly id: string) { super(); }
    }
    expect(router.register(new InvalidProvider("bad\\nprovider")).ok).toBe(false);
    expect(router.register(new InvalidProvider("x".repeat(129))).ok).toBe(false);
  });

  it("rejects duplicate provider IDs", () => {
    const router = new ModelRouter();
    router.register(new FakeProvider());
    expect(router.register(new FakeProvider()).ok).toBe(false);
  });

  it("streams events from the selected provider", async () => {
    const router = new ModelRouter();
    router.register(new FakeProvider());
    const events = [];
    for await (const event of router.stream("fake", {
      model: "fake-model",
      messages: [{ role: "user", content: "Hi" }]
    })) events.push(event);

    expect(events.map(event => event.type)).toEqual(["text_delta", "text_delta", "completed"]);
  });

  it("validates optional generation parameters before dispatch", async () => {
    const router = new ModelRouter();
    router.register(new FakeProvider());
    await expect(async () => {
      for await (const _event of router.stream("fake", {
        model: "fake-model",
        messages: [{ role: "user", content: "Hi" }],
        temperature: 2.1
      })) { /* consume */ }
    }).rejects.toThrow(/temperature/i);
    await expect(async () => {
      for await (const _event of router.stream("fake", {
        model: "fake-model",
        messages: [{ role: "user", content: "Hi" }],
        maxOutputTokens: 0
      })) { /* consume */ }
    }).rejects.toThrow(/output tokens/i);
  });

  it("rejects requests that exceed native host message limits before dispatch", async () => {
    const router = new ModelRouter();
    router.register(new FakeProvider());
    const consume = (messages: ModelRequest["messages"]) => async () => {
      for await (const _event of router.stream("fake", { model: "fake-model", messages })) { /* consume */ }
    };
    await expect(consume(Array.from({ length: 101 }, () => ({ role: "user" as const, content: "x" })))).rejects.toThrow(/1 and 100/i);
    await expect(consume([{ role: "user", content: "я".repeat(50_001) }])).rejects.toThrow(/100 KB/i);
    await expect(consume(Array.from({ length: 11 }, () => ({ role: "user" as const, content: "x".repeat(90_910) })))).rejects.toThrow(/1 MB/i);
  });

  it("rejects control characters and oversized model IDs before dispatch", async () => {
    const router = new ModelRouter();
    router.register(new FakeProvider());
    const consume = (model: string) => async () => {
      for await (const _event of router.stream("fake", { model, messages: [{ role: "user", content: "Hi" }] })) { /* consume */ }
    };
    await expect(consume("bad\nmodel")).rejects.toThrow(/Model ID/i);
    await expect(consume("x".repeat(129))).rejects.toThrow(/Model ID/i);
  });

  it("reports an unavailable provider", async () => {
    const router = new ModelRouter();
    await expect(async () => {
      for await (const _event of router.stream("missing", {
        model: "x",
        messages: [{ role: "user", content: "Hi" }]
      })) { /* consume */ }
    }).rejects.toThrow(/not registered/);
  });
});


describe("ModelRegistry", () => {
  it("refreshes a provider-neutral catalog and selects an active model", async () => {
    const router = new ModelRouter();
    router.register(new FakeProvider());
    const registry = new ModelRegistry(router, () => 1234);

    expect(registry.getSnapshot().state).toBe("unknown");
    expect((await registry.refresh()).ok).toBe(true);
    expect(registry.getSnapshot()).toEqual({ state: "ready", checkedAt: 1234, modelCount: 1 });
    const selected = registry.setActiveModel("fake", "fake-model");
    expect(selected.ok).toBe(true);
    const active = registry.getActiveModel();
    expect(active.ok && active.value.displayName).toBe("Fake Model");
  });

  it("prevents an older overlapping refresh from overwriting a newer catalog", async () => {
    type ListResult = Awaited<ReturnType<ModelProvider["listModels"]>>;
    const pending: Array<(result: ListResult) => void> = [];
    class DeferredProvider implements ModelProvider {
      readonly id = "deferred";
      listModels(): Promise<ListResult> {
        return new Promise(resolve => pending.push(resolve));
      }
      async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: "completed" }; }
    }
    const router = new ModelRouter();
    router.register(new DeferredProvider());
    const registry = new ModelRegistry(router, () => 777);

    const olderRefresh = registry.refresh();
    const newerRefresh = registry.refresh();
    const newerModel: ModelDescriptor = {
      id: "new-model", providerId: "deferred", displayName: "New Model",
      supportsStreaming: true, supportsTools: false
    };
    pending[1](ok([newerModel]));
    expect((await newerRefresh).ok).toBe(true);

    const olderModel: ModelDescriptor = {
      id: "old-model", providerId: "deferred", displayName: "Old Model",
      supportsStreaming: true, supportsTools: false
    };
    pending[0](ok([olderModel]));
    expect(await olderRefresh).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(registry.listModels().map(model => model.id)).toEqual(["new-model"]);
    expect(registry.getSnapshot()).toMatchObject({ state: "ready", modelCount: 1 });
  });

  it("does not select models before a successful catalog refresh", () => {
    const registry = new ModelRegistry(new ModelRouter());
    expect(registry.setActiveModel("fake", "fake-model").ok).toBe(false);
    expect(registry.getActiveModel().ok).toBe(false);
  });

  it("clears an active model when a later catalog no longer contains it", async () => {
    const router = new ModelRouter();
    router.register(new FakeProvider());
    const registry = new ModelRegistry(router);
    await registry.refresh();
    registry.setActiveModel("fake", "fake-model");
    router.unregister("fake");
    await registry.refresh();
    expect(registry.getActiveModel().ok).toBe(false);
    expect(registry.getSnapshot().state).toBe("ready");
    expect(registry.getSnapshot().modelCount).toBe(0);
  });

  it("reports provider discovery failures without claiming readiness", async () => {
    class FailedProvider implements ModelProvider {
      readonly id = "failed";
      async listModels() { return { ok: false as const, error: { code: "provider_unavailable" as const, message: "Gateway offline", retryable: true } }; }
      async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: "completed" }; }
    }
    const router = new ModelRouter();
    router.register(new FailedProvider());
    const registry = new ModelRegistry(router, () => 99);
    const result = await registry.refresh();
    expect(result.ok).toBe(false);
    expect(registry.getSnapshot()).toMatchObject({ state: "unavailable", checkedAt: 99, error: "Gateway offline" });
  });

  it("rejects control characters and oversized model IDs returned by a provider", async () => {
    class InvalidProvider implements ModelProvider {
      readonly id = "invalid";
      constructor(private readonly modelId: string) {}
      async listModels() {
        return ok([{
          id: this.modelId, providerId: this.id, displayName: "Invalid",
          supportsStreaming: true, supportsTools: false
        }]);
      }
      async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> {
        yield { type: "completed" };
      }
    }
    for (const modelId of ["bad" + String.fromCharCode(10) + "model", "я".repeat(65)]) {
      const router = new ModelRouter();
      router.register(new InvalidProvider(modelId));
      const registry = new ModelRegistry(router);
      expect(await registry.refresh()).toMatchObject({
        ok: false, error: { code: "validation" }
      });
      expect(registry.getSnapshot().state).toBe("unavailable");
    }
  });

  it("rejects duplicate provider/model identities returned by a provider", async () => {
    class DuplicateProvider implements ModelProvider {
      readonly id = "duplicate";
      async listModels() {
        const model: ModelDescriptor = { id: "same", providerId: this.id, displayName: "Same", supportsStreaming: true, supportsTools: false };
        return ok([model, model]);
      }
      async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> { yield { type: "completed" }; }
    }
    const router = new ModelRouter();
    router.register(new DuplicateProvider());
    const registry = new ModelRegistry(router);
    expect((await registry.refresh()).ok).toBe(false);
    expect(registry.getSnapshot().state).toBe("unavailable");
  });
});
