import type { ManagedRun } from "./agentRunManager";
export function latestAgentRun(runs: readonly ManagedRun[], conversationId: string): ManagedRun | null {
  let selected: ManagedRun | undefined;
  for (const run of runs) if (run.conversationId === conversationId && (!selected || run.startedAt >= selected.startedAt)) selected = run;
  return selected ? { ...selected } : null;
}