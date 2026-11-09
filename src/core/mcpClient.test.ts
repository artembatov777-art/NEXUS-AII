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
const initializeResult = () => ({
  protocolVersion: "2024-11-05",
  capabilities: { tools: {} },
  serverInfo: { name: "test server", version: "1.0" }
});
const transportWith = (respond: (request: McpRequest) => McpResponse): McpTransport => ({
  request: vi.fn(async request => respond(request)),
  notify: vi.fn(async () => undefined)
});

describe("McpClient", () => {
  it("initializes, negotiates capabilities, sends initialized notification and imports tools through the gateway", async () => {
    const tools = gateway();
    const registry = new ToolRegistry(tools);
    const transport: McpTransport = {
      request: vi.fn(async (request: McpRequest): Promise<McpResponse> => request.method === "initialize"
        ? { jsonrpc: "2.0", id: request.id, result: initializeResult() }
        : request.method === "tools/list"
          ? { jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "lookup", description: "Lookup item" }] } }
          : { jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "ok" }] } }),
      notify: vi.fn(async () => undefined)
    };
    const client = new McpClient(registry, tools);
    const signal = new AbortController().signal;
    expect((await client.connect({ id: "local", name: "Local MCP", version: "1", transport }, signal)).ok).toBe(true);
    expect(transport.notify).toHaveBeenCalledWith("notifications/initialized", {}, signal);
    expect(client.listServers()).toMatchObject([{ id: "local", health: "healthy", protocolVersion: "2024-11-05" }]);
    const discovered = await client.listTools("local", signal);
    expect(discovered.ok && discovered.value[0].name).toBe("lookup");
    const imported = client.importTool("local", { name: "lookup" }, {
      permissions: ["memory:read"], risk: "low", timeoutMs: 1000,
      adapter: { validate: (_server, _tool, input) => ok(input) }
    });
    expect(imported.ok).toBe(true);
    const result = await tools.execute("mcp.local.lookup", { q: "x" },
      { traceId: "t", runId: "r", signal } as ToolExecutionContext, "actor");
    expect(result.ok).toBe(true);
    expect(transport.request).toHaveBeenCalledTimes(3);
    expect(vi.mocked(transport.request).mock.calls[2][0]).toMatchObject({ method: "tools/call", params: { name: "lookup" } });
    await client.disconnect("local");
    expect(registry.get("mcp.local.lookup")).toBeNull();
    expect(client.listServers()).toEqual([]);
  });

  it("rejects unsupported protocol versions and malformed initialization", async () => {
    const tools = gateway();
    const client = new McpClient(new ToolRegistry(tools), tools);
    const transport = transportWith(request => ({
      jsonrpc: "2.0", id: request.id,
      result: { ...initializeResult(), protocolVersion: "2099-01-01" }
    }));
    const result = await client.connect({ id: "bad-version", name: "Bad", version: "1", transport }, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: "tool_failed" } });
  });

  it("supports bounded tools/list pagination and rejects repeated cursors", async () => {
    const tools = gateway();
    const client = new McpClient(new ToolRegistry(tools), tools);
    const transport: McpTransport = {
      request: vi.fn(async (request: McpRequest): Promise<McpResponse> => request.method === "initialize"
        ? { jsonrpc: "2.0", id: request.id, result: initializeResult() }
        : request.params && "cursor" in (request.params as object)
          ? { jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "second" }] } }
          : { jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "first" }], nextCursor: "page-2" } }),
      notify: async () => undefined
    };
    await client.connect({ id: "pages", name: "Pages", version: "1", transport }, new AbortController().signal);
    const listed = await client.listTools("pages", new AbortController().signal);
    expect(listed).toMatchObject({ ok: true, value: [{ name: "first" }, { name: "second" }] });
  });

  it("updates server health on ping failure and recovers on a later ping", async () => {
    const tools = gateway();
    const client = new McpClient(new ToolRegistry(tools), tools);
    let online = false;
    const transport: McpTransport = {
      request: async request => {
        if (request.method === "initialize") return { jsonrpc: "2.0", id: request.id, result: initializeResult() };
        if (!online) throw new Error("offline");
        return { jsonrpc: "2.0", id: request.id, result: {} };
      },
      notify: async () => undefined
    };
    await client.connect({ id: "health", name: "Health", version: "1", transport }, new AbortController().signal);
    expect((await client.ping("health", new AbortController().signal)).ok).toBe(false);
    expect(client.listServers()[0].health).toBe("degraded");
    online = true;
    expect((await client.ping("health", new AbortController().signal)).ok).toBe(true);
    expect(client.listServers()[0].health).toBe("healthy");
  });

  it("fails closed on pre-cancelled requests and disconnects imported tools", async () => {
    const tools = gateway();
    const registry = new ToolRegistry(tools);
    const client = new McpClient(registry, tools);
    const broken: McpTransport = { request: async () => { throw new Error("socket closed"); }, notify: async () => undefined };
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
        result: request.method === "initialize" ? initializeResult() : { tools: [{ name: "../unsafe" }] }
      }),
      notify: async () => undefined
    };
    await client.connect({ id: "meta", name: "Meta", version: "1", transport }, new AbortController().signal);
    const result = await client.listTools("meta", new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: "tool_failed" } });
  });
});
