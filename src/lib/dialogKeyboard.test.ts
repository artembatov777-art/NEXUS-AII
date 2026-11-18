import { describe, expect, it } from "vitest";
import { resolveDialogKeyboardAction } from "./dialogKeyboard";

describe("modal dialog keyboard behavior", () => {
  it("closes the active dialog on Escape", () => {
    expect(resolveDialogKeyboardAction("Escape", false, 1, 4)).toEqual({ type: "close" });
  });

  it("wraps Shift+Tab from the first or outside element to the last control", () => {
    expect(resolveDialogKeyboardAction("Tab", true, 0, 4)).toEqual({ type: "focus", index: 3 });
    expect(resolveDialogKeyboardAction("Tab", true, -1, 4)).toEqual({ type: "focus", index: 3 });
  });

  it("wraps Tab from the last or outside element to the first control", () => {
    expect(resolveDialogKeyboardAction("Tab", false, 3, 4)).toEqual({ type: "focus", index: 0 });
    expect(resolveDialogKeyboardAction("Tab", false, -1, 4)).toEqual({ type: "focus", index: 0 });
  });

  it("allows normal tab movement between controls", () => {
    expect(resolveDialogKeyboardAction("Tab", false, 1, 4)).toBeNull();
    expect(resolveDialogKeyboardAction("Tab", true, 2, 4)).toBeNull();
  });

  it("prevents tabbing into the page when the dialog has no focusable controls", () => {
    expect(resolveDialogKeyboardAction("Tab", false, -1, 0)).toEqual({ type: "prevent" });
  });

  it("ignores unrelated keys", () => {
    expect(resolveDialogKeyboardAction("Enter", false, 0, 2)).toBeNull();
  });
});
