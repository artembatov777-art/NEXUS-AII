import type { ManagedRunStatus } from "./agentRunManager";
const labels: Record<ManagedRunStatus, string> = { running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
export function agentRunStatusLabel(status: ManagedRunStatus): string { return labels[status]; }