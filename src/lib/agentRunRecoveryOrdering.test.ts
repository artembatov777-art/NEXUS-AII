import { describe, expect, it } from "vitest";
import { AgentRunManager } from "./agentRunManager";
import type { AgentCheckpoint } from "../core/agentCheckpoints";

describe("checkpoint recovery ordering", () => {
  it("restores the newest valid snapshot when a run has multiple checkpoint versions", () => {
    const manager = new AgentRunManager();
    const base: AgentCheckpoint = {
      schemaVersion: 1, runId: "run-1", agentId: "agent-1",
      threadId: "standalone", sequence: 1, status: "running",
      state: {}, createdAt: 100, updatedAt: 100
    };
    manager.restoreCheckpoints("standalone", [
      base,
      { ...base, sequence: 2, status: "completed", updatedAt: 200 }
    ]);
    expect(manager.list("standalone")).toMatchObject([
      { id: "run-1", status: "completed", finishedAt: 200 }
    ]);
  });
});
