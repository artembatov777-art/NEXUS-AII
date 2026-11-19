import type { ManagedRun } from "./agentRunManager";
export function latestAgentRun(runs: readonly ManagedRun[], conversationId: string): ManagedRun | null {
  const selected = runs.filter(run => run.conversationId === conversationId).sort((a,b) => b.startedAt - a.startedAt)[0];
  return selected ? { ...selected } : null;
}