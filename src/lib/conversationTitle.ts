export const NEW_CONVERSATION_TITLE = "New conversation";

export function resolveConversationTitle(currentTitle: string, firstUserMessage: string): string {
  if (currentTitle !== NEW_CONVERSATION_TITLE) return currentTitle;
  const normalized = firstUserMessage.replace(/\s+/gu, " ").trim();
  const title = Array.from(normalized).slice(0, 36).join("");
  return title || currentTitle;
}
