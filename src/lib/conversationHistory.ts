import type { Conversation } from "../types";

/** Return conversations belonging to the selected project and matching the history query. */
export function filterConversationHistory(
  conversations: Conversation[],
  projectId: string,
  query: string
): Conversation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return conversations.filter(conversation => {
    if ((conversation.projectId ?? "") !== projectId) return false;
    if (!normalizedQuery) return true;
    const searchableText = [conversation.title, ...conversation.messages.map(message => message.content)]
      .join(" ")
      .toLocaleLowerCase();
    return searchableText.includes(normalizedQuery);
  });
}
