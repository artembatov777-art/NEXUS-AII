/** Preserve the original standalone IDs and give each conversation disjoint checkpoint threads. */
export function agentThreads(conversationId?: string): { primary: string; planned: string; test: string } {
  const base = conversationId ? `nexus-session:${conversationId.length}:${conversationId}` : "nexus-agent-control-center";
  return { primary: base, planned: `${base}-planned`, test: `${base}-workspace-test` };
}
