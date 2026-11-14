import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCheckpoint } from "../core/agentCheckpoints";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { NativeAgentCheckpointRepository } from "./nativeAgentCheckpointRepository";

const checkpoint: AgentCheckpoint = {
  schemaVersion: 1,
  runId: "run-1",
  agentId: "agent-1",
  threadId: "thread-1",
  sequence: 1,
  status: "running",
  state: { payload: { task: "persist" } },
  createdAt: 100,
  updatedAt: 100
};

describe("NativeAgentCheckpointRepository", () => {
  beforeEach(() => invokeMock.mockReset());

  it("maps checkpoint operations to native SQLite commands", async () => {
    invokeMock.mockResolvedValueOnce(checkpoint)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([checkpoint])
      .mockResolvedValueOnce(undefined);
    const repository = new NativeAgentCheckpointRepository();

    await expect(repository.get("run-1")).resolves.toEqual({ ok: true, value: checkpoint });
    await expect(repository.save(checkpoint, null)).resolves.toEqual({ ok: true, value: undefined });
    await expect(repository.listByThread("thread-1", 20)).resolves.toEqual({ ok: true, value: [checkpoint] });
    await expect(repository.delete("run-1")).resolves.toEqual({ ok: true, value: undefined });

    expect(invokeMock.mock.calls).toEqual([
      ["load_agent_checkpoint", { runId: "run-1" }],
      ["save_agent_checkpoint", { checkpoint, expectedPreviousSequence: null }],
      ["list_agent_checkpoints", { threadId: "thread-1", limit: 20 }],
      ["delete_agent_checkpoint", { runId: "run-1" }]
    ]);
  });

  it("converts native command failures into retryable storage errors", async () => {
    invokeMock.mockRejectedValueOnce(new Error("SQLite is busy."));
    const result = await new NativeAgentCheckpointRepository().get("run-1");
    expect(result).toMatchObject({
      ok: false,
      error: { code: "storage_failed", message: "SQLite is busy.", retryable: true }
    });
  });
});
