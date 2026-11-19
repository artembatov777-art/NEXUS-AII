import { expect, it } from "vitest";
import { agentRunEventPreview } from "./agentRunEventPreview";
it("truncates long terminal output without changing short messages", () => {
  expect(agentRunEventPreview("ok", 4)).toBe("ok");
  expect(agentRunEventPreview("abcdef", 3)).toBe("abc…");
  expect(() => agentRunEventPreview("a", 0)).toThrow();
});