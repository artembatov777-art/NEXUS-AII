import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_PROFILE } from "./agentProfile";
import { createLocalWorkflowDefinition, registerBuiltInAgentSuite } from "./agentCatalog";
import { createNexusRuntime } from "./nexusRuntime";
import type { StorageLike } from "./memoryStorage";

describe("local workflow agent configuration", () => {
  it("maps a validated profile to a versioned bounded agent definition", () => {
    const definition = createLocalWorkflowDefinition({
      ...DEFAULT_AGENT_PROFILE,
      name: "Release helper",
      revision: 4,
      maxSteps: 8,
      timeoutMs: 25_000
    });
    expect(definition).toMatchObject({
      name: "Release helper",
      version: "1.4.0",
      maxSteps: 8,
      timeoutMs: 25_000,
      requiredPermissions: ["tool:execute"]
    });
  });
});

class TestStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("built-in agent suite registration", () => {
  it("registers the local preview tool in the planner-visible registry", async () => {
    const runtime = createNexusRuntime({ storage: new TestStorage(), actorId: "test-user" });
    const registered = registerBuiltInAgentSuite(runtime);
    expect(registered.ok).toBe(true);
    expect(runtime.toolRegistry.get("workspace.preview")).toMatchObject({
      id: "workspace.preview", source: "builtin", tags: ["preview", "local"]
    });
    const result = await runtime.toolGateway.execute("workspace.preview", { task: "Prepare a release" }, {
      runId: "catalog-run", traceId: "catalog-trace", signal: new AbortController().signal
    }, "test-user");
    expect(result).toMatchObject({ ok: true, value: { preview: expect.stringContaining("Prepare a release") } });
  });
});
