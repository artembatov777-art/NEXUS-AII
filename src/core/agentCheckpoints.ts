import { err, ok, type Result } from "./result";

export type AgentCheckpointStatus = "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface AgentCheckpoint {
  schemaVersion: 1;
  runId: string;
  agentId: string;
  threadId: string;
  sequence: number;
  status: AgentCheckpointStatus;
  state: JsonValue;
  pendingApproval?: { permission: string; requestedAt: number };
  createdAt: number;
  updatedAt: number;
}

export interface AgentCheckpointRepository {
  get(runId: string): Promise<Result<AgentCheckpoint | null>>;
  save(checkpoint: AgentCheckpoint, expectedPreviousSequence: number | null): Promise<Result<void>>;
  listByThread(threadId: string, limit: number): Promise<Result<AgentCheckpoint[]>>;
  delete(runId: string): Promise<Result<void>>;
}

/** Versioned snapshots with compare-and-swap protection against stale writers. */
export class AgentCheckpointService {
  constructor(private readonly repository: AgentCheckpointRepository) {}

  async persist(checkpoint: AgentCheckpoint): Promise<Result<void>> {
    const validation = validateCheckpoint(checkpoint);
    if (validation) return err("validation", validation);
    let current: Result<AgentCheckpoint | null>;
    try { current = await this.repository.get(checkpoint.runId); }
    catch { return err("storage_failed", "Could not read the previous agent checkpoint.", true); }
    if (!current.ok) return current;

    const previous = current.value;
    if (previous) {
      if (previous.agentId !== checkpoint.agentId || previous.threadId !== checkpoint.threadId) {
        return err("validation", "Checkpoint run identity cannot change.");
      }
      if (previous.status === "completed" || previous.status === "failed" || previous.status === "cancelled") {
        return err("validation", "A terminal agent checkpoint cannot be modified.");
      }
      if (checkpoint.sequence !== previous.sequence + 1) {
        return err("validation", "Checkpoint sequence must increase by exactly one.");
      }
      if (checkpoint.createdAt !== previous.createdAt) {
        return err("validation", "Checkpoint creation time is immutable.");
      }
    } else if (checkpoint.sequence !== 1) {
      return err("validation", "The first checkpoint sequence must be 1.");
    }
    try { return await this.repository.save(checkpoint, previous?.sequence ?? null); }
    catch { return err("storage_failed", "Could not persist the agent checkpoint.", true); }
  }

  get(runId: string): Promise<Result<AgentCheckpoint | null>> {
    return this.repository.get(runId);
  }

  listByThread(threadId: string, limit = 50): Promise<Result<AgentCheckpoint[]>> {
    if (!threadId.trim() || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      return Promise.resolve(err("validation", "Thread id and a limit from 1 to 200 are required."));
    }
    return this.repository.listByThread(threadId, limit);
  }
}

function validateCheckpoint(value: AgentCheckpoint): string | null {
  if (!value || value.schemaVersion !== 1) return "Unsupported checkpoint schema version.";
  if (![value.runId, value.agentId, value.threadId].every(item => typeof item === "string" && item.trim().length > 0 && item.length <= 160)) {
    return "Checkpoint run, agent, and thread identifiers are required.";
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) return "Checkpoint sequence must be a positive safe integer.";
  if (!["running", "waiting_for_approval", "completed", "failed", "cancelled"].includes(value.status)) return "Checkpoint status is invalid.";
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || value.updatedAt < value.createdAt) {
    return "Checkpoint timestamps are invalid.";
  }
  if (value.pendingApproval && (
    value.status !== "waiting_for_approval" ||
    !value.pendingApproval.permission.trim() ||
    !Number.isFinite(value.pendingApproval.requestedAt)
  )) return "Pending approval metadata is invalid.";
  try {
    const serialized = JSON.stringify(value.state);
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 256 * 1024) {
      return "Checkpoint state must be JSON data no larger than 256 KB.";
    }
  } catch { return "Checkpoint state must be serializable JSON data."; }
  return null;
}
