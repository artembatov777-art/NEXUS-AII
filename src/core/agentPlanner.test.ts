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
  it("passes bounded reference context separately from the task goal", async () => {
    let received = "";
    const planner = new AgentPlanner({ createPlan: async ({ goal, referenceContext }) => { received = referenceContext ?? ""; return ok({ goal, steps: [] }); } });
    const result = await planner.plan("Find notes", tools, new AbortController().signal, "Profile preference: concise summaries.");
    expect(result.ok).toBe(true);
    expect(received).toBe("Profile preference: concise summaries.");
  });

  it("rejects oversized reference context before calling the model", async () => {
    const createPlan = vi.fn();
    const planner = new AgentPlanner({ createPlan });
    expect(await planner.plan("Find notes", tools, new AbortController().signal, "x".repeat(12_001))).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(createPlan).not.toHaveBeenCalled();
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
