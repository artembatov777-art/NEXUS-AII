import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_PROFILE } from "./agentProfile";
import { createLocalWorkflowDefinition } from "./agentCatalog";

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
