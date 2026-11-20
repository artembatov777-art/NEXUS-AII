import { describe, expect, it, vi } from "vitest";
import { renderRecoveryCommand } from "./recoveryView";
import { ok, err } from "../src/core/result";
import type { AgentCheckpoint } from "../src/core/agentCheckpoints";
import type { ToolAuditEvent } from "../src/core/tools";

const cp: AgentCheckpoint = {
  schemaVersion: 1, runId: "run-1", agentId: "nexus.cli.workspace",
  threadId: "workspace-cli", sequence: 2, status: "running",
  state: { kind: "nexus.plan-run.v1",
    steps: [{ id: "inspect", toolId: "cli.workspace.read" }],
    nextStep: 0, active: { index: 0, id: "inspect", toolId: "cli.workspace.read" } },
  createdAt: 10, updatedAt: 20
};
const receipt: ToolAuditEvent = {
  runId: "run-1", toolId: "cli.workspace.read", traceId: "run-1:1",
  status: "started", timestamp: 11
};

describe("CLI read-only recovery overview", () => {
  it("reports the active tool and audit ambiguity without any replay operation", async () => {
    const checkpoint = { get: vi.fn(async () => ok(cp)) };
    const audit = { list: vi.fn(async () => ok([receipt])) };
    const output = await renderRecoveryCommand("/recovery run-1", checkpoint, audit);
    expect(output).toContain("run-1");
    expect(output).toContain("cli.workspace.read");
    expect(output).toContain("0/1");
    expect(output).toMatch(/unconfirmed|ambiguous/i);
    expect(output).toContain("/audit status run-1");
    expect(output).not.toMatch(/safe to retry|automatically resume/i);
    expect(checkpoint.get).toHaveBeenCalledOnce();
    expect(audit.list).toHaveBeenCalledOnce();
  });

  it("rejects command injection and never reads the repository for malformed IDs", async () => {
    const checkpoint = { get: vi.fn(async () => ok(cp)) };
    const audit = { list: vi.fn(async () => ok([receipt])) };
    for (const command of ["/recovery ../private", "/recovery run-1 --force",
      "/recovery", "/recovery run-1\n/git push"]) {
      expect(await renderRecoveryCommand(command, checkpoint, audit)).toMatch(/Usage:/);
    }
    expect(checkpoint.get).not.toHaveBeenCalled();
    expect(audit.list).not.toHaveBeenCalled();
    expect(await renderRecoveryCommand("/history", checkpoint, audit)).toBeNull();
  });

  it("blocks misleading summaries when one evidence source is incomplete", async () => {
    const checkpoint = { get: vi.fn(async () => ok(cp)) };
    const audit = { list: vi.fn(async () => err("storage_failed", "unreadable", false)) };
    const output = await renderRecoveryCommand("/recovery run-1", checkpoint, audit);
    expect(output).toMatch(/unavailable|unreadable|unsafe/i);
    expect(output).not.toContain("0 ambiguous");
  });
});
