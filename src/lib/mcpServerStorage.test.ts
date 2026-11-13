import { describe, expect, it } from "vitest";
import { loadMcpServerConfigs, removeMcpServerConfig, saveMcpServerConfig, validateMcpServerConfig } from "./mcpServerStorage";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const server = { id: "local-files", name: "Local Files", endpoint: "http://127.0.0.1:3000/mcp" };

describe("MCP server configuration storage", () => {
  it("accepts HTTPS and loopback HTTP but rejects unsafe endpoints", () => {
    expect(validateMcpServerConfig(server)).toBe(true);
    expect(validateMcpServerConfig({ ...server, endpoint: "https://mcp.example.com/api" })).toBe(true);
    expect(validateMcpServerConfig({ ...server, endpoint: "http://mcp.example.com/api" })).toBe(false);
    expect(validateMcpServerConfig({ ...server, endpoint: "https://user:pass@mcp.example.com/api" })).toBe(false);
    expect(validateMcpServerConfig({ ...server, endpoint: "https://mcp.example.com/api?token=x" })).toBe(false);
  });

  it("persists, loads, and removes endpoint metadata without storing credentials", () => {
    const storage = new MemoryStorage();
    expect(saveMcpServerConfig(storage, server)).toMatchObject({ ok: true });
    expect(loadMcpServerConfigs(storage)).toMatchObject({ ok: true, value: [server] });
    expect(storage.values.get("nexus-au:mcp-servers:v1")).not.toContain("apiKey");
    expect(removeMcpServerConfig(storage, server.id)).toMatchObject({ ok: true, value: [] });
  });

  it("rejects duplicate IDs and corrupt records", () => {
    const storage = new MemoryStorage();
    saveMcpServerConfig(storage, server);
    expect(saveMcpServerConfig(storage, server)).toMatchObject({ ok: false });
    storage.setItem("nexus-au:mcp-servers:v1", JSON.stringify([{ ...server, endpoint: "http://example.com" }]));
    expect(loadMcpServerConfigs(storage)).toMatchObject({ ok: false });
  });
});
