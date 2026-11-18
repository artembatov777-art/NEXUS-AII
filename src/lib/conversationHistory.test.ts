import { describe, expect, it } from "vitest";
import type { Conversation } from "../types";
import { filterConversationHistory } from "./conversationHistory";

const conversations: Conversation[] = [
  {
    id: "personal",
    title: "Personal notes",
    messages: [{ id: "m1", role: "user", content: "Remember the launch checklist", createdAt: 1 }],
    updatedAt: 1
  },
  {
    id: "project-a",
    projectId: "a",
    title: "NEXUS interface",
    messages: [{ id: "m2", role: "assistant", content: "Responsive command deck", createdAt: 2 }],
    updatedAt: 2
  },
  {
    id: "project-b",
    projectId: "b",
    title: "Research",
    messages: [{ id: "m3", role: "user", content: "Interface references", createdAt: 3 }],
    updatedAt: 3
  }
];

describe("conversation history filtering", () => {
  it("keeps results scoped to the selected project", () => {
    expect(filterConversationHistory(conversations, "a", "").map(item => item.id)).toEqual(["project-a"]);
  });

  it("searches titles and message contents without case sensitivity", () => {
    expect(filterConversationHistory(conversations, "a", "COMMAND DECK").map(item => item.id)).toEqual(["project-a"]);
    expect(filterConversationHistory(conversations, "", "LAUNCH CHECKLIST").map(item => item.id)).toEqual(["personal"]);
  });

  it("ignores surrounding query whitespace", () => {
    expect(filterConversationHistory(conversations, "", "  notes  ").map(item => item.id)).toEqual(["personal"]);
  });

  it("returns an empty list when there are no matches", () => {
    expect(filterConversationHistory(conversations, "a", "missing").map(item => item.id)).toEqual([]);
  });
});
