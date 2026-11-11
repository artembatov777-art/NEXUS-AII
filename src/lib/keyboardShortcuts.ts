type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> & {
  target?: EventTarget | null;
};

function isEditableTarget(target?: EventTarget | null): boolean {
  if (!target || typeof target !== "object" || !("closest" in target)) return false;
  const closest = (target as Element).closest;
  if (typeof closest !== "function") return false;
  return Boolean(closest.call(
    target,
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]'
  ));
}

export function matchesNewConversationShortcut(event: ShortcutEvent): boolean {
  return (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k" &&
    !isEditableTarget(event.target);
}
