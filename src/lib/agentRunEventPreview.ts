export function agentRunEventPreview(message: string, maxLength = 240): string {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) throw new Error("Invalid preview length.");
  return message.length <= maxLength ? message : message.slice(0, maxLength) + "…";
}