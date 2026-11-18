import { describe, expect, it } from "vitest";
import { ModelRouter, type ModelEvent, type ModelProvider, type ModelRequest } from "./model";
import { ok } from "./result";
import { classifyModelTask, orderModelRouteCandidates, streamWithModelFailover } from "./modelRouting";

class Provider implements ModelProvider {
  constructor(readonly id: string, private readonly behavior: "ok" | "retry-before-output" | "fail-after-output") {}
  async listModels() { return ok([{ id: this.id + "-model", providerId: this.id, displayName: this.id, supportsStreaming: true, supportsTools: false }]); }
  async *stream(_request: ModelRequest): AsyncIterable<ModelEvent> {
    if (this.behavior === "retry-before-output") throw Object.assign(new Error("temporary outage"), { retryable: true });
    yield { type: "text_delta", text: this.id };
    if (this.behavior === "fail-after-output") throw Object.assign(new Error("connection dropped"), { retryable: true });
    yield { type: "completed", finishReason: "stop" };
  }
}

describe("model task routing", () => {
  it("classifies common Russian and English task intents", () => {
    expect(classifyModelTask([{ role: "user", content: "Исправь ошибку в TypeScript функции" }])).toBe("coding");
    expect(classifyModelTask([{ role: "user", content: "Найди актуальные источники по теме" }])).toBe("research");
    expect(classifyModelTask([{ role: "user", content: "Напиши короткий рассказ" }])).toBe("creative");
    expect(classifyModelTask([{ role: "user", content: "Проанализируй этот план" }])).toBe("analysis");
    expect(classifyModelTask([{ role: "user", content: "Привет" }])).toBe("general");
  });

  it("orders providers by task family and respects explicit preference", () => {
    const candidates = [
      { providerId: "g", modelId: "g1", family: "gemini" },
      { providerId: "c", modelId: "c1", family: "anthropic" },
      { providerId: "d", modelId: "d1", family: "deepseek" }
    ];
    expect(orderModelRouteCandidates(candidates, "coding").map(item => item.providerId)).toEqual(["c", "d", "g"]);
    expect(orderModelRouteCandidates(candidates, "coding", "g")[0].providerId).toBe("g");
  });

  it("fails over to the next provider only before text is emitted", async () => {
    const router = new ModelRouter();
    router.register(new Provider("offline", "retry-before-output"));
    router.register(new Provider("healthy", "ok"));
    const candidates = [
      { providerId: "offline", modelId: "offline-model", family: "other" },
      { providerId: "healthy", modelId: "healthy-model", family: "other" }
    ];
    const events: ModelEvent[] = [];
    for await (const event of streamWithModelFailover(router, candidates, { messages: [{ role: "user", content: "Hi" }] })) events.push(event);
    expect(events).toEqual([{ type: "text_delta", text: "healthy" }, { type: "completed", finishReason: "stop" }]);
  });

  it("never switches provider after user-visible output has started", async () => {
    const router = new ModelRouter();
    router.register(new Provider("partial", "fail-after-output"));
    router.register(new Provider("healthy", "ok"));
    const candidates = [
      { providerId: "partial", modelId: "partial-model", family: "other" },
      { providerId: "healthy", modelId: "healthy-model", family: "other" }
    ];
    const events: ModelEvent[] = [];
    await expect(async () => {
      for await (const event of streamWithModelFailover(router, candidates, { messages: [{ role: "user", content: "Hi" }] })) events.push(event);
    }).rejects.toThrow(/connection dropped/);
    expect(events).toEqual([{ type: "text_delta", text: "partial" }]);
  });
});
