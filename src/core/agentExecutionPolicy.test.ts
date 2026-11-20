import { describe, expect, it } from "vitest";
import { ToolGateway } from "./tools";
import { ToolRegistry } from "./toolRegistry";
import { ok } from "./result";
import { isExecutableToolStep, validateExecutablePlan } from "./agentExecutionPolicy";
import type { ValidatedPlan } from "./agentPlanner";

function registry() {
  const gateway = new ToolGateway({ authorize: async () => "deny" }, {
    record: async () => ok(undefined), list: async () => ok([])
  }, { now: () => 0 });
  const tools = new ToolRegistry(gateway);
  for (const id of ["safe.read", "mcp.notes", "shell.exec"]) {
    tools.register({ id, version: "1", description: "Test tool", requiredPermissions: [],
      risk: "low", timeoutMs: 1_000, validateInput: input => ok(input), execute: async input => ok(input) });
  }
  return tools;
}

const plan = (): ValidatedPlan => ({
  goal: "Inspect", steps: [
    { id: "read", toolId: "safe.read", purpose: "Read A", input: { path: "a.txt" }, dependsOn: [] },
    { id: "search", toolId: "mcp.notes", purpose: "Search notes", input: { term: "a" }, dependsOn: ["read"] }
  ]
});

describe("shared Agent Engine plan execution policy", () => {
  it("binds runtime execution to the current registered tool and owner allowlist", () => {
    const tools = registry();
    expect(isExecutableToolStep("safe.read", tools, ["safe.read"])).toBe(true);
    expect(isExecutableToolStep("shell.exec", tools, ["safe.read"])).toBe(false);
    expect(isExecutableToolStep("mcp.notes", tools, ["mcp.*"])).toBe(true);
    expect(isExecutableToolStep("shell.exec", tools, ["mcp.*"])).toBe(false);
    expect(isExecutableToolStep("safe.read", tools)).toBe(true);
    tools.unregister("safe.read");
    expect(isExecutableToolStep("safe.read", tools)).toBe(false);
  });

  it("rejects a forged or unavailable tool without exposing it to an executor", () => {
    const tools = registry();
    expect(validateExecutablePlan(plan(), tools, ["safe.read"]).ok).toBe(false);
    expect(validateExecutablePlan(plan(), tools, ["safe.read", "mcp.notes"]).ok).toBe(true);
    const forged = plan();
    forged.steps[0].toolId = "shell.exec";
    expect(validateExecutablePlan(forged, tools, ["safe.read", "mcp.*"]).ok).toBe(false);
    tools.unregister("mcp.notes");
    expect(validateExecutablePlan(plan(), tools, ["safe.read", "mcp.*"]).ok).toBe(false);
  });

  it("rejects ambiguous dependencies, repeated ids, invalid payloads, and budgets", () => {
    const tools = registry();
    const bad = [
      { ...plan(), steps: [plan().steps[0], plan().steps[0]] },
      { ...plan(), steps: [{ ...plan().steps[0], dependsOn: ["missing"] }] },
      { ...plan(), steps: [{ ...plan().steps[0], input: { size: Number.NaN } }] },
      { ...plan(), steps: [{ ...plan().steps[0], input: { value: undefined } }] },
      { ...plan(), steps: [{ ...plan().steps[0], input: { ["__proto__"]: "unsafe" } }] },
      { ...plan(), steps: [] },
      { ...plan(), steps: Array.from({ length: 13 }, (_, i) => ({
        id: "step" + i, toolId: "safe.read", purpose: "Inspect", input: {}, dependsOn: []
      })) }
    ];
    for (const candidate of bad) {
      expect(validateExecutablePlan(candidate, tools), JSON.stringify(candidate)).toMatchObject({
        ok: false, error: { code: "validation" }
      });
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(validateExecutablePlan({ goal: "Inspect", steps: [
      { id: "cyclic", toolId: "safe.read", purpose: "Test", input: cycle, dependsOn: [] }
    ] }, tools).ok).toBe(false);
  });

  it("returns an immutable-by-reference snapshot, not the caller's editable plan", () => {
    const tools = registry();
    const original = plan();
    const result = validateExecutablePlan(original, tools, ["safe.read", "mcp.*"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    original.steps[0].toolId = "shell.exec";
    (original.steps[0].input as { path: string }).path = "/unsafe";
    expect(result.value.steps[0].toolId).toBe("safe.read");
    expect(result.value.steps[0].input).toEqual({ path: "a.txt" });
  });
});
