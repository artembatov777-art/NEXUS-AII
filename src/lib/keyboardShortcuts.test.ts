import { describe, expect, it } from "vitest";
import { matchesNewConversationShortcut } from "./keyboardShortcuts";

describe("new conversation keyboard shortcut", () => {
  it.each([
    { key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
    { key: "K", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }
  ])("accepts the platform modifier for %s", event => {
    expect(matchesNewConversationShortcut(event)).toBe(true);
  });

  it.each([
    { key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
    { key: "k", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false },
    { key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
    { key: "j", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
  ])("rejects unrelated shortcuts: %s", event => {
    expect(matchesNewConversationShortcut(event)).toBe(false);
  });
});
