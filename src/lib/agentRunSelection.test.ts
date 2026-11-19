import { expect, it } from "vitest";
import { latestAgentRun } from "./agentRunSelection";
it("selects newest run within a conversation", () => {
  const runs = [{ id: "old", conversationId: "a", status: "completed" as const, startedAt: 1 }, { id: "other", conversationId: "b", status: "completed" as const, startedAt: 20 }, { id: "new", conversationId: "a", status: "running" as const, startedAt: 10 }];
  expect(latestAgentRun(runs, "a")?.id).toBe("new");
  expect(latestAgentRun(runs, "missing")).toBeNull();
});