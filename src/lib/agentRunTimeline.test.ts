import { expect, it } from "vitest";
import { agentRunTimeline } from "./agentRunTimeline";
it("sorts events and excludes other conversations", () => {
  const events = [
    { runId: "a", conversationId: "one", timestamp: 9, kind: "output" as const, message: "late" },
    { runId: "b", conversationId: "two", timestamp: 1, kind: "error" as const, message: "private" },
    { runId: "a", conversationId: "one", timestamp: 2, kind: "progress" as const, message: "early" }
  ];
  expect(agentRunTimeline(events, "one").map(x => x.message)).toEqual(["early", "late"]);
});
