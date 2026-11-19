import { expect, it } from "vitest";
import { filterAgentEvents } from "./agentRunEventFilter";
it("filters errors in the selected conversation only", () => {
  const events = [{ runId: "a", conversationId: "x", timestamp: 1, kind: "error" as const, message: "x" }, { runId: "b", conversationId: "y", timestamp: 2, kind: "error" as const, message: "y" }, { runId: "c", conversationId: "x", timestamp: 3, kind: "output" as const, message: "ok" }];
  expect(filterAgentEvents(events, "x", ["error"]).map(e => e.message)).toEqual(["x"]);
});