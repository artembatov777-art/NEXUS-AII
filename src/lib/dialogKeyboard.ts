export type DialogKeyboardAction =
  | { type: "close" }
  | { type: "focus"; index: number }
  | { type: "prevent" }
  | null;

/** Resolve Escape and Tab behavior for a modal dialog without depending on the DOM. */
export function resolveDialogKeyboardAction(
  key: string,
  shiftKey: boolean,
  activeIndex: number,
  focusableCount: number
): DialogKeyboardAction {
  if (key === "Escape") return { type: "close" };
  if (key !== "Tab") return null;
  if (focusableCount <= 0) return { type: "prevent" };

  if (shiftKey && activeIndex <= 0) {
    return { type: "focus", index: focusableCount - 1 };
  }
  if (!shiftKey && (activeIndex < 0 || activeIndex >= focusableCount - 1)) {
    return { type: "focus", index: 0 };
  }
  return null;
}
