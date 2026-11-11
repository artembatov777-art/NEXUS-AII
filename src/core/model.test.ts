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
