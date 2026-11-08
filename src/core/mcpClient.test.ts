import { describe, it, expect, vi } from "vitest";
import { McpClient } from "./mcpClient";
import { ToolRegistry } from "./toolRegistry";
import { ToolGateway, type ToolExecutionContext } from "./tools";
import { ok } from "./result";
import type { McpRequest, McpResponse, McpTransport } from "./mcpClient";

const gateway = () => new ToolGateway(
  { authorize: async () => "allow" },
  { record: async () => ok(undefined) },
  { now: () => 1 }
);

describe("McpClient", () => {
  it("initializes, discovers and imports a remote tool through the gateway", async () => {
    const tools = gateway();
    const registry = new ToolRegistry(tools);
    const transport: McpTransport = {
      request: vi.fn(async (request: McpRequest): Promise<McpResponse> => request.method === "initialize"
        ? { jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05" } }
        : request.method === "tools/list"
          ? { jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "lookup", description: "Lookup item" }] } }
          : { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "ok" }] } })
    };
    const client = new McpClient(registry, tools);
    const signal = new AbortController().signal;
    expect((await client.connect({ id: "local", name: "Local MCP", version: "1", transport }, signal)).ok).toBe(true);
    const discovered = await client.listTools("local", signal);
    expect(discovered.ok && discovered.value[0].name).toBe("lookup");
    const imported = client.importTool("local", { name: "lookup" }, {
      permissions: ["memory:read"], risk: "low", timeoutMs: 1000, adapter: { validate: (_server, _tool, input) => ok(input) }
    });
    expect(imported.ok).toBe(true);
    const context: ToolExecutionContext = { traceId: "t", runId: "r", signal };
    const result = await tools.execute("mcp.local.lookup", { q: "x" }, context, "actor");
    expect(result.ok).toBe(true);
    expect(transport.request).toHaveBeenCalledTimes(3);
    expect(vi.mocked(transport.request).mock.calls[2][0]).toMatchObject({ method: "tools/call", params: { name: "lookup" } });
  });

  it("rejects mismatched response IDs", async () => {
    const tools = gateway();
    const client = new McpClient(new ToolRegistry(tools), tools);
    const transport: McpTransport = { request: async () => ({ jsonrpc: "2.0", id: 99, result: { protocolVersion: "x" } }) };
    const result = await client.connect({ id: "bad", name: "Bad", version: "1", transport }, new AbortController().signal);
    expect(result.ok).toBe(false);
  });

  it("fails closed on transport disconnect and pre-cancelled requests", async () => {
    const tools = gateway();
    const client = new McpClient(new ToolRegistry(tools), tools);
    const broken: McpTransport = { request: async () => { throw new Error("socket closed"); } };
    const disconnected = await client.connect({ id: "offline", name: "Offline", version: "1", transport: broken }, new AbortController().signal);
    expect(disconnected).toMatchObject({ ok: false, error: { code: "provider_unavailable" } });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await client.connect({ id: "cancel", name: "Cancel", version: "1", transport: broken }, controller.signal);
    expect(cancelled).toMatchObject({ ok: false, error: { code: "cancelled" } });
  });

  it("rejects malformed tool metadata from an MCP server", async () => {
    const tools = gateway();
    const client = new McpClient(new ToolRegistry(tools), tools);
    const transport: McpTransport = {
      request: async request => ({
        jsonrpc: "2.0", id: request.id,
        result: request.method === "initialize" ? { protocolVersion: "x" } : { tools: [{ name: "../unsafe" }] }
      })
    };
    await client.connect({ id: "meta", name: "Meta", version: "1", transport }, new AbortController().signal);
    const result = await client.listTools("meta", new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: "tool_failed" } });
  });
});
