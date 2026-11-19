import type { ManagedRun } from "./agentRunManager";
export interface RunSummary { running: number; completed: number; failed: number; cancelled: number }
export function summarizeRuns(runs: readonly ManagedRun[], conversationId?: string): RunSummary {
  const result: RunSummary = { running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const run of runs) if (conversationId === undefined || run.conversationId === conversationId) result[run.status]++;
  return result;
}
