import type { ManagedRun } from "./agentRunManager";
export function agentRunDuration(run: ManagedRun, now = Date.now()): number {
  return Math.max(0, (run.finishedAt ?? now) - run.startedAt);
}