import { BasicMcpSchemaAdapter } from "./mcpSchemaAdapter";
import { err, ok, type Result } from "./result";
import type { PermissionScope, ToolDefinition, ToolGateway, ToolRisk } from "./tools";
import type { ToolRegistry } from "./toolRegistry";

export interface McpRequest { jsonrpc: "2.0"; id: number; method: string; params?: unknown; }
export interface McpResponse { jsonrpc: "2.0"; id: number; result?: unknown; error?: { code: number; message: string }; }
export interface McpTransport {
  request(request: McpRequest, signal: AbortSignal): Promise<McpResponse>;
  notify(method: string, params: unknown, signal: AbortSignal): Promise<void>;
  close?(): Promise<void>;
}
export interface McpServerConfig { id: string; name: string; version: string; transport: McpTransport; }
export interface McpRemoteTool { name: string; description?: string; inputSchema?: unknown; }
export interface McpToolAdapter { validate(serverId: string, tool: McpRemoteTool, input: unknown): Result<unknown>; }
export interface McpImportedToolOptions { permissions: PermissionScope[]; risk: ToolRisk; timeoutMs: number; adapter?: McpToolAdapter; }
export interface McpServerStatus {
  id: string;
  name: string;
  serverInfo: { name: string; version: string };
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  health: "healthy" | "degraded";
  importedTools: number;
}
interface McpConnection {
  config: McpServerConfig;
  protocolVersion: string;
  serverInfo: { name: string; version: string };
  capabilities: Record<string, unknown>;
  health: "healthy" | "degraded";
  importedToolIds: Set<string>;
}
const SUPPORTED_PROTOCOL_VERSION = "2024-11-05";
const MAX_TOOLS = 200;
const MAX_TOOL_SCHEMA_BYTES = 32_000;
const MAX_RPC_RESULT_BYTES = 2_000_000;
const validId = (value: string) => /^[a-zA-Z0-9._-]{1,80}$/.test(value);

function cloneBoundedJson(value: unknown, maxBytes: number): unknown | null {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > maxBytes) return null;
    const parsed: unknown = JSON.parse(encoded);
    const safe = (item: unknown, depth = 0): boolean => {
      if (depth > 24) return false;
      if (item === null || typeof item === "string" || typeof item === "boolean") return true;
      if (typeof item === "number") return Number.isFinite(item);
      if (Array.isArray(item)) return item.every(child => safe(child, depth + 1));
      if (typeof item !== "object") return false;
      return Object.entries(item).every(([key, child]) =>
        key !== "__proto__" && key !== "constructor" && key !== "prototype" && safe(child, depth + 1)
      );
    };
    return safe(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class McpClient {
  private sequence = 0;
  private readonly servers = new Map<string, McpConnection>();

  constructor(private readonly registry: ToolRegistry, _gateway: ToolGateway) {}

  async connect(config: McpServerConfig, signal: AbortSignal): Promise<Result<{ serverId: string; protocolVersion: string }>> {
    if (!validId(config.id) || !config.name.trim() || config.name.length > 120 ||
        !config.version.trim() || config.version.length > 40 || this.servers.has(config.id)) {
      return err("validation", "MCP server identity is invalid or already connected.");
    }
    const initialized = await this.rpc(config, "initialize", {
      protocolVersion: SUPPORTED_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "NEXUS AU", version: "0.1" }
    }, signal);
    if (!initialized.ok) {
      try { await config.transport.close?.(); } catch { /* Connection setup already failed. */ }
      return initialized;
    }
    const result = initialized.value as {
      protocolVersion?: unknown;
      capabilities?: unknown;
      serverInfo?: unknown;
    };
    if (result?.protocolVersion !== SUPPORTED_PROTOCOL_VERSION ||
        !result.capabilities || typeof result.capabilities !== "object" || Array.isArray(result.capabilities) ||
        !result.serverInfo || typeof result.serverInfo !== "object" ||
        typeof (result.serverInfo as Record<string, unknown>).name !== "string" ||
        typeof (result.serverInfo as Record<string, unknown>).version !== "string") {
      try { await config.transport.close?.(); } catch { /* Invalid initialization response. */ }
      return err("tool_failed", "MCP initialize response is malformed or uses an unsupported protocol version.");
    }
    const capabilities = cloneBoundedJson(result.capabilities, 16_000);
    if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
      try { await config.transport.close?.(); } catch { /* Invalid initialization response. */ }
      return err("tool_failed", "MCP server capabilities are invalid.");
    }
    try {
      await config.transport.notify("notifications/initialized", {}, signal);
    } catch {
      try { await config.transport.close?.(); } catch { /* Notification setup failed. */ }
      return err(signal.aborted ? "cancelled" : "provider_unavailable", "MCP initialized notification failed.");
    }
    this.servers.set(config.id, {
      config,
      protocolVersion: result.protocolVersion,
      serverInfo: {
        name: (result.serverInfo as Record<string, string>).name.slice(0, 120),
        version: (result.serverInfo as Record<string, string>).version.slice(0, 40)
      },
      capabilities: capabilities as Record<string, unknown>,
      health: "healthy",
      importedToolIds: new Set()
    });
    return ok({ serverId: config.id, protocolVersion: result.protocolVersion });
  }

  /** Reconnects using a fresh transport supplied by the host. */
  reconnect(config: McpServerConfig, signal: AbortSignal) {
    return this.connect(config, signal);
  }

  listServers(): McpServerStatus[] {
    return [...this.servers.values()].map(server => ({
      id: server.config.id,
      name: server.config.name,
      serverInfo: { ...server.serverInfo },
      protocolVersion: server.protocolVersion,
      capabilities: cloneBoundedJson(server.capabilities, 16_000) as Record<string, unknown>,
      health: server.health,
      importedTools: server.importedToolIds.size
    }));
  }

  async ping(serverId: string, signal: AbortSignal): Promise<Result<void>> {
    const server = this.servers.get(serverId);
    if (!server) return err("validation", "MCP server is not connected.");
    const result = await this.rpc(server.config, "ping", {}, signal);
    server.health = result.ok ? "healthy" : "degraded";
    return result.ok ? ok(undefined) : result;
  }

  async listTools(serverId: string, signal: AbortSignal): Promise<Result<McpRemoteTool[]>> {
    const server = this.servers.get(serverId);
    if (!server) return err("validation", "MCP server is not connected.");
    if (!("tools" in server.capabilities)) return err("validation", "MCP server did not advertise the tools capability.");
    const output: McpRemoteTool[] = [];
    const toolNames = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await this.rpc(server.config, "tools/list", cursor ? { cursor } : {}, signal);
      if (!response.ok) return response;
      const payload = response.value as { tools?: unknown; nextCursor?: unknown };
      if (!Array.isArray(payload?.tools) || payload.tools.length > MAX_TOOLS ||
          output.length + payload.tools.length > MAX_TOOLS) {
        return err("tool_failed", "MCP tools/list response is invalid or exceeds the 200-tool limit.");
      }
      for (const item of payload.tools) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return err("tool_failed", "MCP server returned invalid tool metadata.");
        }
        const raw = item as Record<string, unknown>;
        if (typeof raw.name !== "string" || !validId(raw.name) ||
            (raw.description !== undefined && (typeof raw.description !== "string" || raw.description.length > 500))) {
          return err("tool_failed", "MCP server returned an invalid tool name or description.");
        }
        const safeSchema = raw.inputSchema === undefined ? undefined : cloneBoundedJson(raw.inputSchema, MAX_TOOL_SCHEMA_BYTES);
        if (raw.inputSchema !== undefined && (!safeSchema || typeof safeSchema !== "object" || Array.isArray(safeSchema))) {
          return err("tool_failed", "MCP tool input schema is invalid or exceeds its size limit.");
        }
        if (toolNames.has(raw.name)) return err("tool_failed", "MCP server returned duplicate tool names.");
        toolNames.add(raw.name);
        output.push({
          name: raw.name,
          ...(typeof raw.description === "string" ? { description: raw.description } : {}),
          ...(safeSchema !== undefined ? { inputSchema: safeSchema } : {})
        });
      }
      if (payload.nextCursor === undefined) return ok(output);
      if (typeof payload.nextCursor !== "string" || !payload.nextCursor.trim() || payload.nextCursor.length > 256 ||
          cursors.has(payload.nextCursor)) {
        return err("tool_failed", "MCP server returned an invalid or repeated pagination cursor.");
      }
      cursor = payload.nextCursor;
      cursors.add(cursor);
    }
    return err("tool_failed", "MCP server exceeded the 10-page tools/list limit.");
  }

  importTool(serverId: string, tool: McpRemoteTool, options: McpImportedToolOptions): Result<void> {
    const server = this.servers.get(serverId);
    if (!server || !validId(tool.name)) return err("validation", "MCP server or tool is invalid.");
    const id = `mcp.${serverId}.${tool.name}`;
    const adapter = options.adapter ?? new BasicMcpSchemaAdapter();
    const definition: ToolDefinition<unknown, unknown> = {
      id,
      version: "mcp-1",
      description: (tool.description || `MCP tool ${tool.name}`).slice(0, 500),
      requiredPermissions: [...options.permissions],
      risk: options.risk,
      timeoutMs: options.timeoutMs,
      validateInput: input => adapter.validate(serverId, tool, input),
      execute: async (input, context) => {
        const active = this.servers.get(serverId);
        if (!active) return err("provider_unavailable", "MCP server disconnected.");
        const response = await this.rpc(active.config, "tools/call", { name: tool.name, arguments: input }, context.signal);
        if (!response.ok) return response;
        const payload = response.value as { isError?: unknown };
        if (payload?.isError === true) return err("tool_failed", "MCP tool reported an execution error.");
        const safe = cloneBoundedJson(payload, 64_000);
        if (!safe || typeof safe !== "object" || Array.isArray(safe)) {
          return err("validation", "MCP tool output is invalid or exceeds the 64 KB limit.");
        }
        return ok(safe);
      }
    };
    const registered = this.registry.register(definition, "mcp", ["mcp", serverId]);
    if (!registered.ok) return registered;
    server.importedToolIds.add(id);
    return ok(undefined);
  }

  async discoverAndImport(
    serverId: string,
    signal: AbortSignal,
    defaults: { permissions: PermissionScope[]; risk: ToolRisk; timeoutMs: number }
  ): Promise<Result<{ discovered: number; imported: string[]; rejected: Array<{ name: string; reason: string }> }>> {
    const listed = await this.listTools(serverId, signal);
    if (!listed.ok) return listed;
    const imported: string[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    for (const tool of listed.value) {
      const result = this.importTool(serverId, tool, { ...defaults });
      if (result.ok) imported.push(tool.name);
      else rejected.push({ name: tool.name, reason: result.error.message });
    }
    return ok({ discovered: listed.value.length, imported, rejected });
  }

  async disconnect(serverId: string): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) return;
    this.servers.delete(serverId);
    for (const id of server.importedToolIds) this.registry.unregister(id);
    try { await server.config.transport.close?.(); } catch { /* Local state is disconnected regardless of close errors. */ }
  }

  private async rpc(config: McpServerConfig, method: string, params: unknown, signal: AbortSignal): Promise<Result<unknown>> {
    if (signal.aborted) return err("cancelled", "MCP request was cancelled.");
    const id = ++this.sequence;
    try {
      const response = await config.transport.request({ jsonrpc: "2.0", id, method, params }, signal);
      if (!response || response.jsonrpc !== "2.0" || response.id !== id) {
        return err("tool_failed", "MCP response correlation failed.");
      }
      if (response.error) {
        if (!Number.isInteger(response.error.code) || typeof response.error.message !== "string") {
          return err("tool_failed", "MCP server returned a malformed JSON-RPC error.");
        }
        return err("tool_failed", `MCP error ${response.error.code}: ${response.error.message.slice(0, 300)}`);
      }
      if (!("result" in response)) return err("tool_failed", "MCP response has no result.");
      if (cloneBoundedJson(response.result, MAX_RPC_RESULT_BYTES) === null) {
        return err("tool_failed", "MCP response result is invalid or exceeds the 2 MB limit.");
      }
      return ok(response.result);
    } catch (cause) {
      return err(signal.aborted ? "cancelled" : "provider_unavailable",
        cause instanceof Error ? cause.message.slice(0, 300) : "MCP transport failed.");
    }
  }
}
