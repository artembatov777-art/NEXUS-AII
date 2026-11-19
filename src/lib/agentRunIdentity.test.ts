import { expect, it } from "vitest";
import { validAgentRunIdentity } from "./agentRunIdentity";
it("rejects empty and malformed run identifiers", () => {
  expect(validAgentRunIdentity("run-1", "chat-1")).toBe(true);
  expect(validAgentRunIdentity(" run", "chat")).toBe(false);
  expect(validAgentRunIdentity("x".repeat(161), "chat")).toBe(false);
});