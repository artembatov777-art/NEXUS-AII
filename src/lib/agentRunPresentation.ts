import type { ManagedRunStatus } from "./agentRunManager";
const labels: Record<ManagedRunStatus, string> = { running: "Running", waiting_for_approval: "Waiting for approval", completed: "Completed", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted" };
export function agentRunStatusLabel(status: ManagedRunStatus): string { return labels[status]; }