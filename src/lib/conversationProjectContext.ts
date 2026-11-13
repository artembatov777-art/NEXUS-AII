export function resolveConversationProjectId(conversation: { projectId?: string }): string | undefined {
  const projectId = conversation.projectId?.trim();
  return projectId || undefined;
}
