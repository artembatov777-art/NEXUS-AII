import { describe, expect, it } from "vitest";
import { validateAgentCheckpoint, type AgentCheckpoint } from "./agentCheckpoints";

const valid: AgentCheckpoint = {
  schemaVersion: 1,
  runId: "run-1",
  agentId: "agent-1",
  threadId: "thread-1",
  sequence: 1,
  status: "running",
  state: { progress: 1 },
  createdAt: 100,
  updatedAt: 100
};

describe("checkpoint security regression matrix", () => {
  it("rejects U+0000 (NUL) in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "run" + String.fromCharCode(0) + "-1" })).not.toBeNull();
  });
});
