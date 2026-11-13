import { describe, expect, it, vi } from "vitest";
import { ToolGateway, type ToolExecutionContext } from "./tools";
import { ok, err, type Result } from "./result";

const context = (): ToolExecutionContext => ({
  traceId: "trace-1",
  runId: "run-1",
  signal: new AbortController().signal
});

const definition = (execute: (input: { query: string }, context: ToolExecutionContext) => Promise<Result<unknown>> = vi.fn().mockResolvedValue(ok({ answer: 42 }))) => ({
  id: "sample",
  version: "1.0.0",
  description: "Sample test tool",
  requiredPermissions: ["conversation:read"] as ("conversation:read")[],
  risk: "low" as const,
  timeoutMs: 2_000,
  validateInput: (input: unknown) => typeof input === "object" && input !== null && "query" in input
    ? ok(input as { query: string })
    : err("validation", "Expected a query object."),
  execute
});

const setup = (decision: "allow" | "deny" | "ask_user" = "allow") => {
  const permissions = { authorize: vi.fn().mockResolvedValue(decision) };
  const audit = { record: vi.fn().mockResolvedValue(ok(undefined)) };
  const gateway = new ToolGateway(permissions, audit, { now: () => 123 });
  return { gateway, permissions, audit };
};

describe("ToolGateway", () => {
  it("accepts the dedicated MCP execution scope", () => {
    const { gateway } = setup();
    const mcpTool = { ...definition(), id: "mcp.remote.search", requiredPermissions: ["mcp:execute"] as ("mcp:execute")[] };
    expect(gateway.register(mcpTool).ok).toBe(true);
  });

  it("blocks replay when a durable audit record already exists for the same run and step", async () => {
    const execute = vi.fn(async () => ok({ answer: 42 }));
    const prior = { toolId: "sample", runId: "run-1", traceId: "trace-1", status: "started" as const, timestamp: 100 };
    const audit = { record: vi.fn().mockResolvedValue(ok(undefined)), list: vi.fn().mockResolvedValue(ok([prior])) };
    const gateway = new ToolGateway({ authorize: vi.fn().mockResolvedValue("allow") }, audit, { now: () => 123 });
    expect(gateway.register(definition(execute)).ok).toBe(true);
    const result = await gateway.execute("sample", { query: "x" }, context(), "actor-1");
    expect(result).toMatchObject({ ok: false, error: { code: "tool_failed", message: expect.stringContaining("will not be replayed automatically") } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed when durable audit history cannot be checked", async () => {
    const execute = vi.fn(async () => ok({ answer: 42 }));
    const audit = { record: vi.fn().mockResolvedValue(ok(undefined)), list: vi.fn().mockResolvedValue(err("storage_failed", "offline")) };
    const gateway = new ToolGateway({ authorize: vi.fn().mockResolvedValue("allow") }, audit, { now: () => 123 });
    expect(gateway.register(definition(execute)).ok).toBe(true);
    const result = await gateway.execute("sample", { query: "x" }, context(), "actor-1");
    expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(execute).not.toHaveBeenCalled();
  });
  it("registers tools and exposes metadata only", () => {
    const { gateway } = setup();
    expect(gateway.register(definition()).ok).toBe(true);
    expect(gateway.list()).toHaveLength(1);
    expect(gateway.list()[0]).not.toHaveProperty("execute");
    expect(gateway.register(definition()).ok).toBe(false);
  });

  it("rejects invalid permission scopes and missing host identity", async () => {
    const { gateway } = setup();
    const invalid = { ...definition(), requiredPermissions: ["root:access"] as never };
    expect(gateway.register(invalid).ok).toBe(false);
    gateway.register(definition());
    const result = await gateway.execute("sample", { query: "hello" }, context(), " ");
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
  });

  it("validates input before requesting permission", async () => {
    const { gateway, permissions } = setup();
    gateway.register(definition());
    const result = await gateway.execute("sample", { wrong: true }, context(), "user-1");
    expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(permissions.authorize).not.toHaveBeenCalled();
  });

  it("resolves a scoped permission resource from validated input without exposing the resolver in metadata", async () => {
    const { gateway, permissions } = setup();
    const tool = { ...definition(), resourceForInput: (input: { query: string }) => input.query };
    expect(gateway.register(tool).ok).toBe(true);
    expect(gateway.list()[0]).not.toHaveProperty("resourceForInput");
    await gateway.execute("sample", { query: "C:\\approved\\notes.txt" }, context(), "user-1");
    expect(permissions.authorize).toHaveBeenCalledWith(expect.objectContaining({
      resource: "C:\\approved\\notes.txt"
    }));
  });

  it("executes only after every permission is granted and audits lifecycle", async () => {
    const { gateway, permissions, audit } = setup();
    const tool = definition();
    gateway.register(tool);
    const result = await gateway.execute("sample", { query: "hello" }, context(), "user-1");
    expect(result).toEqual(ok({ answer: 42 }));
    expect(permissions.authorize).toHaveBeenCalledOnce();
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(audit.record.mock.calls.map(call => call[0].status)).toEqual(["started", "completed"]);
  });

  it("fails closed when permission is denied or approval is needed", async () => {
    for (const decision of ["deny", "ask_user"] as const) {
      const { gateway, audit } = setup(decision);
      const tool = definition();
      gateway.register(tool);
      const result = await gateway.execute("sample", { query: "hello" }, context(), "user-1");
      expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
      expect(tool.execute).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ status: "denied" }));
    }
  });

  it("blocks execution if the audit start event cannot be persisted", async () => {
    const { gateway, audit } = setup();
    audit.record.mockResolvedValueOnce(err("storage_failed", "offline"));
    const tool = definition();
    gateway.register(tool);
    const result = await gateway.execute("sample", { query: "hello" }, context(), "user-1");
    expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it("does not recommend retry when the tool completed but completion audit failed", async () => {
    const { gateway, audit } = setup();
    audit.record.mockResolvedValueOnce(ok(undefined)).mockResolvedValueOnce(err("storage_failed", "offline"));
    const tool = definition();
    gateway.register(tool);
    const result = await gateway.execute("sample", { query: "hello" }, context(), "user-1");
    expect(tool.execute).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: false,
      error: { code: "side_effect_completed_audit_failed", retryable: false }
    });
  });

  it("rejects oversized input and output", async () => {
    const { gateway } = setup();
    gateway.register(definition());
    const largeInput = await gateway.execute("sample", { query: "x".repeat(70_000) }, context(), "user-1");
    expect(largeInput).toMatchObject({ ok: false, error: { code: "validation" } });

    const outputGateway = setup().gateway;
    outputGateway.register(definition(vi.fn().mockResolvedValue(ok("x".repeat(70_000)))));
    const largeOutput = await outputGateway.execute("sample", { query: "hello" }, context(), "user-1");
    expect(largeOutput).toMatchObject({ ok: false, error: { code: "tool_failed" } });
  });

  it("does not run tools for pre-cancelled requests", async () => {
    const { gateway, permissions } = setup();
    const tool = definition();
    gateway.register(tool);
    const controller = new AbortController();
    controller.abort();
    const result = await gateway.execute("sample", { query: "hello" }, { ...context(), signal: controller.signal }, "user-1");
    expect(result).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(permissions.authorize).not.toHaveBeenCalled();
    expect(tool.execute).not.toHaveBeenCalled();
  });
});
