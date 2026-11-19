export function resolveConversationProjectId(conversation: { projectId?: string }): string | undefined {
  const projectId = conversation.projectId?.trim();
  return projectId || undefined;
}

/** Existing conversations keep their own project boundary even if the selector changes. */
export function resolveAgentProjectId(conversation: { projectId?: string } | null, selectedProjectId: string, hasActiveSession = false): string | undefined {
  return conversation ? resolveConversationProjectId(conversation) : hasActiveSession ? undefined : selectedProjectId.trim() || undefined;
}
