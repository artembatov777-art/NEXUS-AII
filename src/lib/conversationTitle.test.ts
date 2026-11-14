import { describe, expect, it } from "vitest";
import { NEW_CONVERSATION_TITLE, resolveConversationTitle } from "./conversationTitle";

describe("resolveConversationTitle", () => {
  it("uses the first user message for a new conversation", () => {
    expect(resolveConversationTitle(NEW_CONVERSATION_TITLE, "How do I organize my projects?"))
      .toBe("How do I organize my projects?");
  });

  it("normalizes whitespace and trims the generated title", () => {
    expect(resolveConversationTitle(NEW_CONVERSATION_TITLE, "  Build   a\n personal\tAI  "))
      .toBe("Build a personal AI");
  });

  it("limits titles by Unicode code points without splitting emoji", () => {
    const title = resolveConversationTitle(NEW_CONVERSATION_TITLE, "😀".repeat(40));
    expect(Array.from(title)).toHaveLength(36);
    expect(title).toBe("😀".repeat(36));
  });

  it("preserves an existing conversation title", () => {
    expect(resolveConversationTitle("Project planning", "A different first message"))
      .toBe("Project planning");
  });

  it("keeps the default title when the first message is empty", () => {
    expect(resolveConversationTitle(NEW_CONVERSATION_TITLE, " \n\t "))
      .toBe(NEW_CONVERSATION_TITLE);
  });
});
