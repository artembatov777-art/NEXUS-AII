import { describe, expect, it } from "vitest";
import { agentThreads } from "./agentThreads";

describe("agent checkpoint ownership", () => {
  it("preserves standalone thread names for existing checkpoints", () => {
    expect(agentThreads()).toEqual({ primary: "nexus-agent-control-center", planned: "nexus-agent-control-center-planned", test: "nexus-agent-control-center-workspace-test" });
  });
  it("keeps each terminal conversation in distinct namespaces", () => {
    const one = agentThreads("one");
    const two = agentThreads("two");
    expect(new Set([...Object.values(one), ...Object.values(two)]).size).toBe(6);
    expect(agentThreads("one")).toEqual(one);
  });
});
