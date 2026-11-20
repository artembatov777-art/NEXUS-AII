import { describe, expect, it } from "vitest";
import { formatAgentRunDiagnostics } from "./agentRunDiagnostics";
import type { AgentCheckpoint } from "../core/agentCheckpoints";
import type { ToolAuditEvent } from "../core/tools";
import type { TraceEvent } from "../core/observability";

const checkpoint: AgentCheckpoint = {
  schemaVersion: 1, runId: "run-7", agentId: "agent-a",
  threadId: "thread-1", status: "failed", sequence: 4,
  state: { payload: { secret: "DO_NOT_EXPORT", task: "private conversation" }, steps: 2 },
  createdAt: 100, updatedAt: 400
};
const audit: ToolAuditEvent[] = [
  { runId: "run-7", traceId: "run-7:1", toolId: "workspace.read", status: "started", timestamp: 200, detail: "TOKEN_DO_NOT_EXPORT" },
  { runId: "run-7", traceId: "run-7:1", toolId: "workspace.read", status: "failed", timestamp: 250 },
  { runId: "other-run", traceId: "other-run:1", toolId: "workspace.write", status: "completed", timestamp: 300 }
];
const traces: TraceEvent[] = [
  { runId: "run-7", traceId: "trace-7", name: "agent.run", status: "failed", timestamp: 350, attributes: { prompt: "DO_NOT_EXPORT" } },
  { runId: "other-run", traceId: "trace-other", name: "agent.run", status: "completed", timestamp: 375 }
];

describe("safe agent run diagnostics", () => {
  it("formats a local troubleshooting report without persisted task content or credentials", () => {
    const report = formatAgentRunDiagnostics(checkpoint, audit, traces);
    expect(report).toContain("Run: run-7");
    expect(report).toContain("Status: failed");
    expect(report).toContain("Checkpoint: 4");
    expect(report).toContain("workspace.read");
    expect(report).toContain("agent.run");
    expect(report).not.toContain("DO_NOT_EXPORT");
    expect(report).not.toContain("private conversation");
    expect(report).not.toContain("other-run");
    expect(report).not.toContain("workspace.write");
  });

  it("keeps reports bounded even with thousands of audit and trace entries", () => {
    const events = Array.from({ length: 3000 }, (_, index) => ({
      ...audit[0], timestamp: 1000 + index
    }));
    const report = formatAgentRunDiagnostics(checkpoint, events, traces);
    expect(report.length).toBeLessThan(20_000);
    expect(report).toContain("audit events omitted");
  });

  it("does not export raw audit details even when they resemble ordinary error text", () => {
    const report = formatAgentRunDiagnostics(checkpoint, [{ ...audit[0], detail: "Raw external response" }], []);
    expect(report).not.toContain("Raw external response");
  });
});
