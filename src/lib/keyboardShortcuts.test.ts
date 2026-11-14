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

  it("does not intercept the shortcut while typing in an editable control", () => {
    const target = {
      closest: (selector: string) => selector.includes("textarea") ? {} : null
    } as unknown as EventTarget;
    expect(matchesNewConversationShortcut({
      key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target
    })).toBe(false);
  });

  it("does not intercept the shortcut from inside an open dialog", () => {
    const target = {
      closest: (selector: string) => selector.includes('[role="dialog"]') ? {} : null
    } as unknown as EventTarget;
    expect(matchesNewConversationShortcut({
      key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target
    })).toBe(false);
  });

  it("still accepts the shortcut when focus is outside editable controls", () => {
    const target = {
      closest: () => null
    } as unknown as EventTarget;
    expect(matchesNewConversationShortcut({
      key: "k", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, target
    })).toBe(true);
  });
});
