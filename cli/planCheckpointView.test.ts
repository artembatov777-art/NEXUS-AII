import { describe, expect, it, vi } from "vitest";
import { ok, err } from "../src/core/result";
import type { AgentCheckpoint } from "../src/core/agentCheckpoints";
import { renderPlanCheckpointCommand } from "./planCheckpointView";

const checkpoint: AgentCheckpoint = {
  schemaVersion: 1, runId: "run-1", agentId: "nexus.cli.workspace",
  threadId: "workspace-cli", sequence: 2, status: "running",
  state: {
    kind: "nexus.plan-run.v1",
    steps: [{ id: "read", toolId: "cli.workspace.read" }],
    nextStep: 0,
    active: { index: 0, id: "read", toolId: "cli.workspace.read" }
  },
  createdAt: 100, updatedAt: 200
};

describe("read-only CLI plan checkpoint inspection", () => {
  it("shows the exact in-flight step and warns against unsafe replay", async () => {
    const repository = {
      get: vi.fn(async () => ok(checkpoint)),
      listByThread: vi.fn(async () => ok([checkpoint]))
    };
    const output = await renderPlanCheckpointCommand("/checkpoint run-1", repository);
    expect(output).toContain("run-1");
    expect(output).toContain("cli.workspace.read");
    expect(output).toMatch(/unconfirmed|uncertain|ambiguous/i);
    expect(output).toContain("/audit status run-1");
    expect(repository.get).toHaveBeenCalledWith("run-1");
    expect(repository.listByThread).not.toHaveBeenCalled();
  });

  it("lists bounded checkpoint metadata without reading tool inputs or executing tools", async () => {
    const repo = {
      get: vi.fn(async () => ok(checkpoint)),
      listByThread: vi.fn(async () => ok([checkpoint]))
    };
    const result = await renderPlanCheckpointCommand("/checkpoints 1", repo);
    expect(result).toContain("run-1");
    expect(result).toMatch(/running/i);
    expect(repo.listByThread).toHaveBeenCalledWith("workspace-cli", 1);
    expect(repo.get).not.toHaveBeenCalled();
    expect(await renderPlanCheckpointCommand("/checkpoint ../secret", repo)).toContain("Usage:");
    expect(await renderPlanCheckpointCommand("/checkpoints 51", repo)).toContain("Usage:");
    expect(await renderPlanCheckpointCommand("/checkpoints 0", repo)).toContain("Usage:");
    expect(await renderPlanCheckpointCommand("/history", repo)).toBeNull();
  });

  it("fails closed for corrupted state and unrelated threads or agents", async () => {
    const unrelated = { ...checkpoint, threadId: "somebody-else" };
    const bad = { ...checkpoint, state: { unexpected: "shape" } };
    const repo = {
      get: vi.fn(async () => ok(unrelated)),
      listByThread: vi.fn(async () => ok([unrelated]))
    };
    expect(await renderPlanCheckpointCommand("/checkpoint run-1", repo)).toMatch(/not found|unavailable/i);
    repo.get.mockResolvedValue(ok(bad));
    expect(await renderPlanCheckpointCommand("/checkpoint run-1", repo)).toMatch(/unreadable|unsupported|unsafe/i);
  });

  it("never interprets failed storage access as an empty set of completed work", async () => {
    const repo = {
      get: vi.fn(async () => err("storage_failed", "corrupt", false)),
      listByThread: vi.fn(async () => err("storage_failed", "corrupt", false))
    };
    expect(await renderPlanCheckpointCommand("/checkpoint run-1", repo)).toMatch(/unreadable|unavailable/i);
    expect(await renderPlanCheckpointCommand("/checkpoints", repo)).toMatch(/unreadable|unavailable/i);
    expect(await renderPlanCheckpointCommand("/checkpoints", repo)).not.toMatch(/no runs found/i);
  });

  it("reports a completed plan without suggesting a retry", async () => {
    const completed: AgentCheckpoint = { ...checkpoint, sequence: 4, status: "completed",
      state: { kind: "nexus.plan-run.v1",
        steps: [{ id: "read", toolId: "cli.workspace.read" }], nextStep: 1, active: null } };
    const repo = {
      get: vi.fn(async () => ok(completed)),
      listByThread: vi.fn(async () => ok([completed]))
    };
    const output = await renderPlanCheckpointCommand("/checkpoint run-1", repo);
    expect(output).toMatch(/completed/i);
    expect(output).not.toMatch(/unconfirmed tool|retry automatically/i);
  });
});
