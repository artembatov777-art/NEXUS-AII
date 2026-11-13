import type { McpRequest, McpResponse, McpTransport } from "./mcpClient";

export interface McpHttpTransportOptions { endpoint: string; fetcher?: typeof fetch; headers?: Record<string, string>; }
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_SSE_EVENT_BYTES = 256_000;
const MAX_SSE_EVENTS = 1_000;

async function readBoundedText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("MCP response exceeded the 2 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

/** Parses bounded SSE frames and selects the JSON-RPC response correlated to this request. */
export function parseMcpSseResponse(body: string, expectedId: number): McpResponse {
  const lines = body.split(/\r?\n/);
  let dataLines: string[] = [];
  let frameBytes = 0;
  let frameCount = 0;
  let matched: McpResponse | undefined;

  const flush = () => {
    if (dataLines.length === 0) return;
    frameCount += 1;
    if (frameCount > MAX_SSE_EVENTS) throw new Error("MCP SSE response contains too many events.");
    const data = dataLines.join("\n");
    dataLines = [];
    frameBytes = 0;
    if (data === "[DONE]") return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); }
    catch { throw new Error("MCP SSE event contained invalid JSON."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const message = parsed as Partial<McpResponse>;
    if (message.id !== expectedId) return;
    if (matched) throw new Error("MCP SSE response contains duplicate correlated responses.");
    matched = parsed as McpResponse;
  };

  for (const line of lines) {
    if (line === "") { flush(); continue; }
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      const value = line.slice(5).replace(/^ /, "");
      frameBytes += new TextEncoder().encode(value).byteLength;
      if (frameBytes > MAX_SSE_EVENT_BYTES) throw new Error("MCP SSE event exceeded the 256 KB limit.");
      dataLines.push(value);
    }
  }
  flush();
  if (!matched) throw new Error("MCP SSE response contained no JSON-RPC response for this request.");
  return matched;
}

export class McpHttpTransport implements McpTransport {
  private readonly endpoint: URL;
  private readonly fetcher: typeof fetch;
  private readonly headers: Record<string, string>;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;

  constructor(options: McpHttpTransportOptions) {
    const url = new URL(options.endpoint);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv4 = hostname.split(".");
    const loopbackIpv4 = ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255) && Number(ipv4[0]) === 127;
    const loopback = hostname === "localhost" || hostname === "::1" || loopbackIpv4;
    if (!["http:", "https:"].includes(url.protocol) ||
        (url.protocol === "http:" && !loopback) ||
        url.username || url.password || url.search || url.hash) {
      throw new Error("MCP endpoint must use HTTPS (HTTP is loopback-only) and cannot contain credentials, query parameters, or fragments.");
    }
    this.endpoint = url;
    this.fetcher = options.fetcher ?? fetch;
    this.headers = { ...(options.headers ?? {}) };
    for (const key of Object.keys(this.headers)) {
      if (/^(host|content-length|cookie|origin)$/i.test(key)) throw new Error(`Header "${key}" cannot be overridden.`);
    }
  }

  private sessionHeaders(): Record<string, string> {
    return {
      ...(this.sessionId ? { "MCP-Session-Id": this.sessionId } : {}),
      ...(this.protocolVersion ? { "MCP-Protocol-Version": this.protocolVersion } : {})
    };
  }

  async close(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = null;
    if (!sessionId) return;
    const response = await this.fetcher(this.endpoint.toString(), {
      method: "DELETE",
      headers: { ...this.headers, "MCP-Session-Id": sessionId, ...(this.protocolVersion ? { "MCP-Protocol-Version": this.protocolVersion } : {}) },
      credentials: "omit",
      redirect: "error",
      cache: "no-store"
    });
    if (![200, 202, 204, 405].includes(response.status)) throw new Error(`MCP session close failed with status ${response.status}.`);
  }

  async notify(method: string, params: unknown, signal: AbortSignal): Promise<void> {
    if (!method.trim() || method.length > 160) throw new Error("MCP notification method is invalid.");
    const response = await this.fetcher(this.endpoint.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", ...this.headers, ...this.sessionHeaders() },
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store"
    });
    if (response.status !== 202) throw new Error(`MCP notification must be acknowledged with HTTP 202 (received ${response.status}).`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > 0) throw new Error("MCP notification response must not contain a body.");
    if (response.body) {
      const body = await readBoundedText(response);
      if (body.length > 0) throw new Error("MCP notification response must not contain a body.");
    }
  }

  async request(request: McpRequest, signal: AbortSignal): Promise<McpResponse> {
    const response = await this.fetcher(this.endpoint.toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json, text/event-stream", ...this.headers, ...this.sessionHeaders() },
      body: JSON.stringify(request),
      signal,
      credentials: "omit",
      redirect: "error",
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`MCP HTTP request failed with status ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("MCP response exceeded the 2 MB limit.");
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const body = await readBoundedText(response);
    let message: McpResponse;
    if (type === "application/json") message = JSON.parse(body) as McpResponse;
    else if (type === "text/event-stream") message = parseMcpSseResponse(body, request.id);
    else throw new Error("MCP server returned an unsupported content type.");

    if (request.method === "initialize") {
      const result = message.result as { protocolVersion?: unknown } | undefined;
      if (typeof result?.protocolVersion !== "string" || result.protocolVersion.length > 40) {
        throw new Error("MCP initialize response did not include a valid protocol version.");
      }
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId && (sessionId.length > 1024 || /[\\u0000-\\u001f\\u007f]/.test(sessionId))) {
        throw new Error("MCP server returned an invalid session identifier.");
      }
      this.sessionId = sessionId;
      this.protocolVersion = result.protocolVersion;
    }
    return message;
  }
}
