import { describe, expect, it, vi } from "vitest";
import { GatewayAgentToolExecutor } from "./agentToolBridge";
import { ToolGateway } from "./tools";
import { ok } from "./result";
import type { AgentRunId } from "./agents";

describe("GatewayAgentToolExecutor", () => {
  it("routes agent tool calls through permissions and audit", async () => {
    const permissions = { authorize: vi.fn().mockResolvedValue("allow") };
    const audit = { record: vi.fn().mockResolvedValue(ok(undefined)) };
    const gateway = new ToolGateway(permissions, audit, { now: () => 100 });
    const execute = vi.fn().mockResolvedValue(ok({ title: "result" }));
    gateway.register({
      id: "notes.search", version: "1", description: "Search notes",
      requiredPermissions: ["memory:read"], risk: "low", timeoutMs: 1_000,
      validateInput: (input: unknown) => input && typeof input === "object" && "query" in input
        ? ok(input as { query: string })
        : { ok: false as const, error: { code: "validation" as const, message: "Invalid", retryable: false } },
      execute
    });
    const bridge = new GatewayAgentToolExecutor(gateway, "user-1");
    const controller = new AbortController();
    const result = await bridge.execute("notes.search", { query: "NEXUS" }, {
      runId: "agent-run-1" as AgentRunId, step: 2, signal: controller.signal
    });
    expect(result).toEqual(ok({ title: "result" }));
    expect(permissions.authorize).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1", scope: "memory:read", resource: "notes.search"
    }));
    expect(execute).toHaveBeenCalledOnce();
    expect(audit.record.mock.calls.map(call => call[0].status)).toEqual(["started", "completed"]);
  });

  it("does not permit the agent to choose an actor identity or bypass cancellation", async () => {
    const gateway = { execute: vi.fn() } as unknown as ToolGateway;
    const missingActor = new GatewayAgentToolExecutor(gateway, " ");
    const controller = new AbortController();
    const invalid = await missingActor.execute("tool", {}, {
      runId: "run" as AgentRunId, step: 1, signal: controller.signal
    });
    expect(invalid).toMatchObject({ ok: false, error: { code: "permission_denied" } });

    const bridge = new GatewayAgentToolExecutor(gateway, "user-1");
    controller.abort();
    const cancelled = await bridge.execute("tool", {}, {
      runId: "run" as AgentRunId, step: 1, signal: controller.signal
    });
    expect(cancelled).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(gateway.execute).not.toHaveBeenCalled();
  });
});
