import { invoke } from "@tauri-apps/api/core";
import type { AgentCheckpoint, AgentCheckpointRepository } from "../core/agentCheckpoints";
import { err, ok, type Result } from "../core/result";

function storageFailure(error: unknown, fallback: string): Result<never> {
  return err("storage_failed", error instanceof Error ? error.message : fallback, true);
}

/** Transactional SQLite-backed checkpoint repository for the native desktop host. */
export class NativeAgentCheckpointRepository implements AgentCheckpointRepository {
  async get(runId: string): Promise<Result<AgentCheckpoint | null>> {
    try {
      return ok(await invoke<AgentCheckpoint | null>("load_agent_checkpoint", { runId }));
    } catch (error) {
      return storageFailure(error, "Could not load the native agent checkpoint.");
    }
  }

  async save(checkpoint: AgentCheckpoint, expectedPreviousSequence: number | null): Promise<Result<void>> {
    try {
      await invoke("save_agent_checkpoint", { checkpoint, expectedPreviousSequence });
      return ok(undefined);
    } catch (error) {
      return storageFailure(error, "Could not save the native agent checkpoint.");
    }
  }

  async listByThread(threadId: string, limit: number): Promise<Result<AgentCheckpoint[]>> {
    try {
      return ok(await invoke<AgentCheckpoint[]>("list_agent_checkpoints", { threadId, limit }));
    } catch (error) {
      return storageFailure(error, "Could not list native agent checkpoints.");
    }
  }

  async delete(runId: string): Promise<Result<void>> {
    try {
      await invoke("delete_agent_checkpoint", { runId });
      return ok(undefined);
    } catch (error) {
      return storageFailure(error, "Could not delete the native agent checkpoint.");
    }
  }
}
