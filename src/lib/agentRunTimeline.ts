import type { ManagedRunEvent } from "./agentRunManager";
export function agentRunTimeline(events: readonly ManagedRunEvent[], conversationId: string): ManagedRunEvent[] {
  return events.filter(event => event.conversationId === conversationId)
    .map(event => ({ ...event }))
    .sort((a, b) => a.timestamp - b.timestamp || a.runId.localeCompare(b.runId));
}
