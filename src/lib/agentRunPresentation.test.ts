import { expect, it } from "vitest";
import { agentRunStatusLabel } from "./agentRunPresentation";
it("maps every managed run state to a human-readable label", () => {
  expect(agentRunStatusLabel("running")).toBe("Running");
  expect(agentRunStatusLabel("cancelled")).toBe("Cancelled");
});