import { describe, expect, it } from "vitest";
import type { AgentRunId } from "../core/agents";
import { collectEvents } from "../testUtils/collectEvents";
import { createNexusRuntime, type NexusRuntimeIds } from "./nexusRuntime";
import { BUILT_IN_AGENT_IDS, registerBuiltInAgentSuite } from "./agentCatalog";
import type { StorageLike } from "./memoryStorage";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("built-in agent suite", () => {
  it("requires a one-time approval, routes its tool call through the gateway and persists the result", async () => {
    let runCounter = 0;
    const ids: NexusRuntimeIds = {
      runId: () => ("catalog-run-" + (++runCounter)) as AgentRunId,
      approvalId: () => "catalog-approval-once"
    };
    const runtime = createNexusRuntime({
      storage: new MemoryStorage(),
      actorId: "local-user",
      ids,
      clock: { now: () => 1_000 },
      permissions: {
        authorizeAgent: async () => "ask_user",
        authorizeTool: async () => "deny"
      }
    });
    expect(registerBuiltInAgentSuite(runtime).ok).toBe(true);

    const waiting = await collectEvents(runtime.agentRuntime.start(
      BUILT_IN_AGENT_IDS.localWorkflow,
      "Prepare a release checklist",
      "catalog-thread"
    ));
    expect(waiting).toEqual([{ type: "waiting_for_approval", runId: "catalog-run-1", permission: "tool:execute" }]);

    const grant = await runtime.issueApproval("catalog-run-1" as AgentRunId);
    expect(grant.ok).toBe(true);
    if (!grant.ok) throw new Error("Expected a one-time grant.");
    const events = await collectEvents(runtime.agentRuntime.resume("catalog-run-1" as AgentRunId, grant.value));
    expect(events.map(event => event.type)).toEqual(["started", "progress", "output", "completed"]);
    expect(events.find(event => event.type === "output")).toMatchObject({
      content: expect.stringContaining("Prepare a release checklist")
    });

    const audit = await runtime.auditSink.list({ runId: "catalog-run-1" });
    expect(audit).toMatchObject({ ok: true, value: [{ toolId: "workspace.preview", status: "started" }, { toolId: "workspace.preview", status: "completed" }] });
    const checkpoint = await runtime.checkpointService.get("catalog-run-1");
    expect(checkpoint).toMatchObject({ ok: true, value: { status: "completed" } });
  });

  it("rejects invalid task input before any run is created", async () => {
    const ids: NexusRuntimeIds = {
      runId: () => "invalid-task-run" as AgentRunId,
      approvalId: () => "unused"
    };
    const runtime = createNexusRuntime({ storage: new MemoryStorage(), actorId: "local-user", ids });
    expect(registerBuiltInAgentSuite(runtime).ok).toBe(true);
    const events = await collectEvents(runtime.agentRuntime.start(BUILT_IN_AGENT_IDS.localWorkflow, "   ", "catalog-thread"));
    expect(events.at(-1)).toMatchObject({ type: "failed" });
    expect(await runtime.checkpointService.get("invalid-task-run")).toMatchObject({ ok: true, value: null });
  });
});
