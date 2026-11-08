import { describe, it, expect } from "vitest";
import { AgentPlanner } from "./agentPlanner";
import { ok } from "./result";
const tools = [{ id: "notes.search", version: "1", description: "Search", requiredPermissions: ["memory:read" as const], risk: "low" as const, timeoutMs: 1000, source: "builtin" as const, tags: [] }];
describe("AgentPlanner", () => {
  it("accepts a bounded plan using available tools", async () => {
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [{ id: "s1", toolId: "notes.search", purpose: "Find notes", input: { query: "x" }, dependsOn: [] }] }) });
    const result = await planner.plan("Find notes", tools, new AbortController().signal);
    expect(result.ok).toBe(true);
  });
  it("rejects unknown tools", async () => {
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [{ id: "s1", toolId: "unknown", purpose: "bad", input: {}, dependsOn: [] }] }) });
    expect(await planner.plan("Do task", tools, new AbortController().signal)).toMatchObject({ ok: false, error: { code: "validation" } });
  });
  it("rejects forward dependencies", async () => {
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [{ id: "a", toolId: "notes.search", purpose: "bad dependency", input: {}, dependsOn: ["b"] }] }) });
    expect(await planner.plan("x", tools, new AbortController().signal)).toMatchObject({ ok: false, error: { code: "validation" } });
  });
  it("rejects oversized plan inputs", async () => {
    const planner = new AgentPlanner({ createPlan: async ({ goal }) => ok({ goal, steps: [{ id: "a", toolId: "notes.search", purpose: "large", input: { value: "x".repeat(70_000) }, dependsOn: [] }] }) });
    expect(await planner.plan("x", tools, new AbortController().signal)).toMatchObject({ ok: false, error: { code: "validation" } });
  });
});
