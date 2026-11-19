import type { ManagedRunEvent } from "./agentRunManager";
export function filterAgentEvents(events: readonly ManagedRunEvent[], conversationId: string, kinds: readonly ManagedRunEvent["kind"][]): ManagedRunEvent[] {
  return events.filter(event => event.conversationId === conversationId && kinds.includes(event.kind)).map(event => ({ ...event }));
}