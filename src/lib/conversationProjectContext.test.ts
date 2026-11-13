import { describe, expect, it } from "vitest";
import { resolveConversationProjectId } from "./conversationProjectContext";

describe("conversation project context", () => {
  it("uses the conversation's persisted project ownership", () => {
    expect(resolveConversationProjectId({ projectId: "project-alpha" })).toBe("project-alpha");
  });

  it("does not attach project context to an unassigned conversation", () => {
    expect(resolveConversationProjectId({})).toBeUndefined();
  });
});
