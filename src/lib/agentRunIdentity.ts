export function validAgentRunIdentity(runId: string, conversationId: string): boolean {
  return [runId, conversationId].every(value => value.length > 0 && value.length <= 160 && value.trim() === value && !/[\u0000-\u001f]/.test(value));
}