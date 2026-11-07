import { describe, expect, it } from "vitest";
import type { ModelDescriptor } from "./domain";
import { ModelRouter, type ModelEvent, type ModelProvider, type ModelRequest } from "./model";
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
