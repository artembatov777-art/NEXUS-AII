import { describe, expect, it } from "vitest";
import { summarizeRuns } from "./agentRunSummary";
import type { ManagedRun } from "./agentRunManager";
describe("summarizeRuns", () => {
  it("counts runs in the selected conversation only", () => {
    const runs = [
      { id: "1", conversationId: "a", status: "running", startedAt: 1 },
      { id: "2", conversationId: "a", status: "failed", startedAt: 2 },
      { id: "3", conversationId: "b", status: "completed", startedAt: 3 }
    ] satisfies ManagedRun[];
    expect(summarizeRuns(runs, "a")).toEqual({ running: 1, completed: 0, failed: 1, cancelled: 0 });
    expect(summarizeRuns(runs).completed).toBe(1);
  });
});
