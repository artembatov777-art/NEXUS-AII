import { expect, it } from "vitest";
import { parseAgentProgress } from "./agentRunProgress";
it("rejects invalid progress and normalizes labels", () => {
  expect(parseAgentProgress(2, 3, " step ")).toEqual({ current: 2, total: 3, label: "step" });
  expect(parseAgentProgress(4, 3, "bad")).toBeNull();
  expect(parseAgentProgress(NaN, 3, "bad")).toBeNull();
});
