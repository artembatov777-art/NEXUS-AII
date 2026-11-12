import { describe, it, expect } from "vitest";
import { ModelRouter } from "./model";
import { ModelRouterPlanner } from "./modelPlanner";
import { ok } from "./result";

describe("ModelRouterPlanner", () => {
  it("parses a JSON plan from the selected model provider", async () => {
    const router = new ModelRouter();
    router.register({
      id: "test",
      listModels: async () => ok([]),
      stream: async function* () {
        yield {
          type: "text_delta" as const,
          text: '{"goal":"Build","steps":[{"id":"s1","toolId":"notes.search","purpose":"Find","input":{},"dependsOn":[]}]}'
        };
        yield { type: "completed" as const, finishReason: "stop" };
      }
    });
    const planner = new ModelRouterPlanner(router, "test", "mock");
    const result = await planner.createPlan({
      goal: "Build",
      tools: [{ id: "notes.search", version: "1", description: "Search", requiredPermissions: [], risk: "low", timeoutMs: 1000, source: "builtin", tags: [] }],
      signal: new AbortController().signal
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.steps).toHaveLength(1);
  });

  it("rejects malformed model JSON", async () => {
    const router = new ModelRouter();
    router.register({
      id: "test",
      listModels: async () => ok([]),
      stream: async function* () {
        yield { type: "text_delta" as const, text: "not json" };
        yield { type: "completed" as const, finishReason: "stop" };
      }
    });
    const result = await new ModelRouterPlanner(router, "test", "mock").createPlan({
      goal: "x", tools: [], signal: new AbortController().signal
    });
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("preserves normalized authentication errors from the model provider", async () => {
    const router = new ModelRouter();
    router.register({
      id: "test",
      listModels: async () => ok([]),
      stream: async function* () {
        throw Object.assign(new Error("The provider rejected the saved credentials."), {
          code: "authentication",
          retryable: false
        });
      }
    });
    const result = await new ModelRouterPlanner(router, "test", "mock").createPlan({
      goal: "Build", tools: [], signal: new AbortController().signal
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "authentication", retryable: false }
    });
  });

  it("rejects a valid-looking plan when the provider stream never completes", async () => {
    const router = new ModelRouter();
    router.register({
      id: "test",
      listModels: async () => ok([]),
      stream: async function* () {
        yield { type: "text_delta" as const, text: '{"goal":"Build","steps":[]}' };
      }
    });
    const result = await new ModelRouterPlanner(router, "test", "mock").createPlan({
      goal: "Build", tools: [], signal: new AbortController().signal
    });
    expect(result).toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
  });
});
