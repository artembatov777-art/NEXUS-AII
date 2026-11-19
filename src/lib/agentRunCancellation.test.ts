import { expect, it } from "vitest";
import { raceAgentCancellation } from "./agentRunCancellation";
it("rejects when the signal aborts before task completion", async () => {
  const controller = new AbortController();
  const pending = new Promise<number>(() => {});
  const result = raceAgentCancellation(pending, controller.signal);
  controller.abort();
  await expect(result).rejects.toThrow("cancelled");
});
it("returns completed tasks", async () => {
  expect(await raceAgentCancellation(Promise.resolve(5), new AbortController().signal)).toBe(5);
});
