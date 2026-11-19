export interface AgentProgress { current: number; total: number; label: string }
export function parseAgentProgress(current: number, total: number, label: string): AgentProgress | null {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || total < 1 || current < 0 || current > total) return null;
  const trimmed = label.trim();
  if (!trimmed || trimmed.length > 240) return null;
  return { current, total, label: trimmed };
}
