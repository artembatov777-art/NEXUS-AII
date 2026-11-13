import { describe, it, expect, vi } from "vitest";
import { McpHttpTransport, parseMcpSseResponse } from "./mcpHttpTransport";

describe("McpHttpTransport", () => {
  it("posts JSON-RPC with credentials omitted and parses JSON response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true, protocolVersion: "2024-11-05" } }),
      { status: 200, headers: { "content-type": "application/json" } }));
    const transport = new McpHttpTransport({ endpoint: "https://mcp.example/tools", fetcher });
    const result = await transport.request({ jsonrpc: "2.0", id: 1, method: "initialize" }, new AbortController().signal);
    expect(result.result).toEqual({ ok: true, protocolVersion: "2024-11-05" });
    expect(fetcher).toHaveBeenCalledWith("https://mcp.example/tools", expect.objectContaining({ credentials: "omit", redirect: "error" }));
  });

  it("retains MCP session and protocol headers and closes the server session", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const method = String(init?.method);
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (method === "POST" && JSON.parse(String(init?.body)).method === "initialize") {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "test", version: "1" } } }),
          { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "session-123" } });
      }
      if (method === "POST" && JSON.parse(String(init?.body)).method === "notifications/initialized") return new Response(null, { status: 202 });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const transport = new McpHttpTransport({ endpoint: "https://mcp.example/tools", fetcher });
    const signal = new AbortController().signal;
    await transport.request({ jsonrpc: "2.0", id: 1, method: "initialize" }, signal);
    await transport.notify("notifications/initialized", {}, signal);
    await transport.request({ jsonrpc: "2.0", id: 2, method: "ping" }, signal);
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ "MCP-Session-Id": "session-123", "MCP-Protocol-Version": "2024-11-05" });
    expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({ "MCP-Session-Id": "session-123", "MCP-Protocol-Version": "2024-11-05" });
    await transport.close();
    expect(fetcher.mock.calls[3][1]).toMatchObject({ method: "DELETE", headers: { "MCP-Session-Id": "session-123" } });
  });

  it("sends JSON-RPC notifications without an id and requires HTTP 202", async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
      return new Response(null, { status: 202 });
    });
    const transport = new McpHttpTransport({ endpoint: "https://mcp.example/tools", fetcher });
    await expect(transport.notify("notifications/initialized", {}, new AbortController().signal)).resolves.toBeUndefined();
    fetcher.mockImplementation(async () => new Response("unexpected", { status: 200 }));
    await expect(transport.notify("notifications/initialized", {}, new AbortController().signal)).rejects.toThrow(/HTTP 202/);
  });

  it("allows HTTP only for loopback and rejects unsafe endpoint URL components", () => {
    expect(() => new McpHttpTransport({ endpoint: "http://mcp.example/tools" })).toThrow(/HTTPS/);
    expect(() => new McpHttpTransport({ endpoint: "http://127.0.0.1:9000/tools" })).not.toThrow();
    expect(() => new McpHttpTransport({ endpoint: "http://[::1]:9000/tools" })).not.toThrow();
    expect(() => new McpHttpTransport({ endpoint: "https://user:pass@example.com" })).toThrow();
    expect(() => new McpHttpTransport({ endpoint: "https://mcp.example/tools?token=secret" })).toThrow();
    expect(() => new McpHttpTransport({ endpoint: "https://mcp.example/tools#fragment" })).toThrow();
  });

  it("rejects an oversized declared response before reading its body", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": "2000001" } }));
    const transport = new McpHttpTransport({ endpoint: "https://mcp.example/tools", fetcher });
    await expect(transport.request({ jsonrpc: "2.0", id: 1, method: "initialize" }, new AbortController().signal)).rejects.toThrow(/2 MB/);
  });

  it("bounds streamed responses even when content-length is missing", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(1_500_000));
      controller.enqueue(new Uint8Array(600_001));
      controller.close();
    } });
    const fetcher = vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    const transport = new McpHttpTransport({ endpoint: "https://mcp.example/tools", fetcher });
    await expect(transport.request({ jsonrpc: "2.0", id: 1, method: "initialize" }, new AbortController().signal)).rejects.toThrow(/2 MB/);
  });

  it("selects the matching JSON-RPC response from multiple SSE frames", () => {
    const body = [
      ": keepalive",
      "event: message",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"value":1}}',
      "",
      'data: {"jsonrpc":"2.0","id":7,',
      'data: "result":{"ready":true}}',
      ""
    ].join("\n");
    expect(parseMcpSseResponse(body, 7)).toMatchObject({ jsonrpc: "2.0", id: 7, result: { ready: true } });
  });

  it("rejects duplicate, malformed, oversized and uncorrelated SSE frames", () => {
    expect(() => parseMcpSseResponse('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n', 1)).toThrow(/duplicate/);
    expect(() => parseMcpSseResponse("data: {broken}\n\n", 1)).toThrow(/invalid JSON/);
    expect(() => parseMcpSseResponse("data: " + "x".repeat(260_000) + "\n\n", 1)).toThrow(/256 KB/);
    expect(() => parseMcpSseResponse('data: {"jsonrpc":"2.0","id":2,"result":{}}\n\n', 1)).toThrow(/no JSON-RPC response/);
  });
});
