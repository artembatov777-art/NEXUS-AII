import { describe, expect, it, vi } from "vitest";
import { ToolGateway, type ToolAuditEvent } from "./tools";
import { ok } from "./result";

const started: ToolAuditEvent = {
  runId: "run-1", toolId: "test.write", traceId: "trace-old",
  status: "started", timestamp: 100
};

function setup(history: unknown) {
  const policy = { authorize: vi.fn(async () => "allow" as const) };
  const recorded: ToolAuditEvent[] = [];
  const audit = {
    list: vi.fn(async () => ok(history as ToolAuditEvent[])),
    record: vi.fn(async (event: ToolAuditEvent) => {
      recorded.push(event);
      return ok(undefined);
    })
  };
  const gateway = new ToolGateway(policy, audit, { now: () => 100 });
  const execute = vi.fn(async () => ok({ changed: true }));
  expect(gateway.register({
    id: "test.write", version: "1", description: "Write a test fixture",
    risk: "high", timeoutMs: 1_000,
    requiredPermissions: ["filesystem:write:selected"],
    validateInput: input => ok(input), execute
  }).ok).toBe(true);
  return { gateway, execute, recorded, policy, audit };
}

describe("ToolGateway complete audit evidence", () => {
  it.each([
    ["cross-run receipt", [{ ...started, runId: "another-run" }]],
    ["invalid timestamp", [{ ...started, timestamp: Number.NaN }]],
    ["unrecognized status", [{ ...started, status: "ghost" }]],
    ["malformed list", { unexpected: "shape" }],
    ["sparse journal", [started, , started]],
    ["accessor-backed receipt", Object.assign([started], { 0: Object.defineProperty({ ...started }, "status", {
      enumerable: true, get: () => "started"
    }) })],
    ["ambiguous limit", Array.from({ length: 5_000 }, (_, i) => ({
      ...started, traceId: "trace-" + i, timestamp: i
    }))]
  ])("fails closed for %s before requesting a write permission", async (_name, history) => {
    const { gateway, execute, recorded, policy } = setup(history);
    const result = await gateway.execute("test.write", { value: 1 },
      { runId: "run-1", traceId: "trace-new", signal: new AbortController().signal }, "owner");
    expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(policy.authorize).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("allows a new traced action when a valid, complete same-run journal is available", async () => {
    const { gateway, execute, recorded } = setup([started]);
    const result = await gateway.execute("test.write", { value: 1 },
      { runId: "run-1", traceId: "trace-new", signal: new AbortController().signal }, "owner");
    expect(result.ok).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(recorded.map(event => event.status)).toEqual(["started", "completed"]);
  });
});
