import { expect, it } from "vitest";
import { agentRunDuration } from "./agentRunDuration";
it("computes completed and running durations without negative values", () => {
  expect(agentRunDuration({ id: "a", conversationId: "b", status: "completed", startedAt: 10, finishedAt: 50 })).toBe(40);
  expect(agentRunDuration({ id: "a", conversationId: "b", status: "running", startedAt: 20 }, 10)).toBe(0);
});