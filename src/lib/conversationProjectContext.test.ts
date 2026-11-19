import { describe, expect, it } from "vitest";
import { resolveAgentProjectId, resolveConversationProjectId } from "./conversationProjectContext";

describe("conversation project context", () => {
  it("uses the conversation's persisted project ownership", () => {
    expect(resolveConversationProjectId({ projectId: "project-alpha" })).toBe("project-alpha");
  });

  it("does not attach project context to an unassigned conversation", () => {
    expect(resolveConversationProjectId({})).toBeUndefined();
  });
});

describe("agent project context", () => {
  it("never attaches the global project to a personal conversation", () => {
    expect(resolveAgentProjectId({}, "project-other")).toBeUndefined();
    expect(resolveAgentProjectId({ projectId: "project-owner" }, "project-other")).toBe("project-owner");
    expect(resolveAgentProjectId(null, "project-other")).toBe("project-other");
    expect(resolveAgentProjectId(null, "project-other", true)).toBeUndefined();
  });
});
