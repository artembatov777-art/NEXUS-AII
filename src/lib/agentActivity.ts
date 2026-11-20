import type { Result } from "../core/result";

export type AgentActivityKind = "started" | "progress" | "approval" | "completed" | "failed" | "cancelled";

/** Strict metadata contract. Deliberately contains no prompt, file content, output or error text. */
export interface AgentActivityEvent {
  runId: string;
  conversationId: string;
  kind: AgentActivityKind;
  timestamp: number;
  step?: number;
  maxSteps?: number;
}

export interface AgentActivityRepository {
  append(event: AgentActivityEvent): Promise<Result<void>>;
  listByConversation(conversationId: string, limit?: number): Promise<Result<AgentActivityEvent[]>>;
}

export const validActivityId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 160 &&
  !/[\u0000-\u001f\u007f]/.test(value);

const EVENT_KEYS = new Set(["runId", "conversationId", "kind", "timestamp", "step", "maxSteps"]);
const EVENT_KINDS: AgentActivityKind[] = ["started", "progress", "approval", "completed", "failed", "cancelled"];

export function validAgentActivityEvent(value: unknown): value is AgentActivityEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  if (!Object.keys(object).every(key => EVENT_KEYS.has(key))) return false;
  if (!validActivityId(object.runId) || !validActivityId(object.conversationId)) return false;
  if (!EVENT_KINDS.includes(object.kind as AgentActivityKind)) return false;
  if (typeof object.timestamp !== "number" || !Number.isFinite(object.timestamp) || object.timestamp < 0) return false;
  const validStep = (step: unknown) => Number.isSafeInteger(step) && Number(step) > 0 && Number(step) <= 100;
  if (object.step !== undefined && !validStep(object.step)) return false;
  if (object.maxSteps !== undefined && !validStep(object.maxSteps)) return false;
  if (object.maxSteps !== undefined && object.step === undefined) return false;
  if (object.step !== undefined && object.kind !== "progress") return false;
  if (object.maxSteps !== undefined && Number(object.step) > Number(object.maxSteps)) return false;
  return true;
}

export function agentActivityLabel(event: AgentActivityEvent): string {
  switch (event.kind) {
    case "started": return "Agent started";
    case "progress": return event.step
      ? event.maxSteps ? `Step ${event.step} of ${event.maxSteps}` : `Step ${event.step}`
      : "Agent progress saved";
    case "approval": return "Approval required";
    case "completed": return "Agent completed";
    case "failed": return "Agent stopped with an error";
    case "cancelled": return "Agent cancelled";
  }
}
