import type { AgentCheckpoint, AgentCheckpointRepository } from "../core/agentCheckpoints";
import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";

const DEFAULT_KEY = "nexus-au:agent-checkpoints:v1";

function isCheckpoint(value: unknown): value is AgentCheckpoint {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AgentCheckpoint>;
  return item.schemaVersion === 1 && typeof item.runId === "string" &&
    typeof item.agentId === "string" && typeof item.threadId === "string" &&
    Number.isSafeInteger(item.sequence) && typeof item.status === "string" &&
    typeof item.createdAt === "number" && typeof item.updatedAt === "number" && "state" in item;
}

export class LocalStorageAgentCheckpointRepository implements AgentCheckpointRepository {
  constructor(private readonly storage: StorageLike, private readonly key = DEFAULT_KEY) {}

  async get(runId: string): Promise<Result<AgentCheckpoint | null>> {
    const records = this.readAll();
    if (!records.ok) return records;
    return ok(records.value.find(item => item.runId === runId) ?? null);
  }

  async save(checkpoint: AgentCheckpoint, expectedPreviousSequence: number | null): Promise<Result<void>> {
    const records = this.readAll();
    if (!records.ok) return records;
    const current = records.value.find(item => item.runId === checkpoint.runId);
    if ((current?.sequence ?? null) !== expectedPreviousSequence) {
      return err("storage_failed", "Checkpoint changed concurrently; reload before retrying.", true);
    }
    const next = records.value.filter(item => item.runId !== checkpoint.runId);
    next.push(checkpoint);
    try { this.storage.setItem(this.key, JSON.stringify(next)); return ok(undefined); }
    catch { return err("storage_failed", "Could not save agent checkpoint.", true); }
  }

  async listByThread(threadId: string, limit: number): Promise<Result<AgentCheckpoint[]>> {
    const records = this.readAll();
    if (!records.ok) return records;
    return ok(records.value.filter(item => item.threadId === threadId)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit));
  }

  async delete(runId: string): Promise<Result<void>> {
    const records = this.readAll();
    if (!records.ok) return records;
    try {
      this.storage.setItem(this.key, JSON.stringify(records.value.filter(item => item.runId !== runId)));
      return ok(undefined);
    } catch { return err("storage_failed", "Could not delete agent checkpoint.", true); }
  }

  private readAll(): Result<AgentCheckpoint[]> {
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === null) return ok([]);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isCheckpoint)) {
        return err("storage_failed", "Agent checkpoint storage contains invalid or unsupported data.");
      }
      return ok(parsed);
    } catch { return err("storage_failed", "Could not read agent checkpoint storage.", true); }
  }
}
