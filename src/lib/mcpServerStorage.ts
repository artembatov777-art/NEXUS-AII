import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";

export interface McpServerConfigRecord {
  id: string;
  name: string;
  endpoint: string;
}
const STORAGE_KEY = "nexus-au:mcp-servers:v1";
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9._-]{1,80}$/.test(value);

export function validateMcpServerConfig(value: unknown): value is McpServerConfigRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!validId(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 ||
      typeof item.endpoint !== "string" || item.endpoint.length > 2048) return false;
  try {
    const url = new URL(item.endpoint);
    const host = url.hostname.toLowerCase().replace(/^\\[|\\]$/g, "");
    const parts = host.split(".");
    const loopbackIpv4 = parts.length === 4 && parts.every(part => /^\\d{1,3}$/.test(part) && Number(part) <= 255) && Number(parts[0]) === 127;
    const loopback = host === "localhost" || host === "::1" || loopbackIpv4;
    return (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}

export function loadMcpServerConfigs(storage: StorageLike): Result<McpServerConfigRecord[]> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return ok([]);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 30 || !parsed.every(validateMcpServerConfig) ||
        new Set(parsed.map(item => item.id)).size !== parsed.length) {
      return err("storage_failed", "Saved MCP server settings are invalid.");
    }
    return ok(parsed);
  } catch { return err("storage_failed", "Could not load MCP server settings.", true); }
}

export function saveMcpServerConfig(storage: StorageLike, config: McpServerConfigRecord): Result<McpServerConfigRecord[]> {
  if (!validateMcpServerConfig(config)) return err("validation", "MCP server name, ID, or secure endpoint is invalid.");
  const current = loadMcpServerConfigs(storage);
  if (!current.ok) return current;
  if (current.value.some(item => item.id === config.id)) return err("validation", "An MCP server with this ID already exists.");
  if (current.value.length >= 30) return err("validation", "A maximum of 30 MCP servers can be saved.");
  const next = [...current.value, { ...config, name: config.name.trim(), endpoint: config.endpoint.trim() }];
  try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); return ok(next); }
  catch { return err("storage_failed", "Could not save MCP server settings.", true); }
}

export function removeMcpServerConfig(storage: StorageLike, id: string): Result<McpServerConfigRecord[]> {
  const current = loadMcpServerConfigs(storage);
  if (!current.ok) return current;
  const next = current.value.filter(item => item.id !== id);
  try { storage.setItem(STORAGE_KEY, JSON.stringify(next)); return ok(next); }
  catch { return err("storage_failed", "Could not update MCP server settings.", true); }
}
