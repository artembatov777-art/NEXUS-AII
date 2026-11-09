import { describe, it, expect } from "vitest";
import { BasicMcpSchemaAdapter } from "./mcpSchemaAdapter";

describe("BasicMcpSchemaAdapter", () => {
  const adapter = new BasicMcpSchemaAdapter();
  const tool = {
    name: "lookup",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "integer" } },
      required: ["query"],
      additionalProperties: false
    }
  };

  it("validates required and typed fields", () => {
    expect(adapter.validate("s", tool, { query: "x", limit: 3 }).ok).toBe(true);
    expect(adapter.validate("s", tool, { limit: 3 }).ok).toBe(false);
    expect(adapter.validate("s", tool, { query: 3 }).ok).toBe(false);
  });

  it("rejects additional properties and unsupported schema keywords at every depth", () => {
    expect(adapter.validate("s", tool, { query: "x", extra: true }).ok).toBe(false);
    expect(adapter.validate("s", { name: "bad", inputSchema: { ...tool.inputSchema, patternProperties: {} } }, { query: "x" }).ok).toBe(false);
    const nested = { name: "nested", inputSchema: { type: "object", properties: { filter: {
      type: "object", properties: { active: { type: "boolean" }, labels: { type: "array", items: { type: "string" } } },
      required: ["active"], additionalProperties: false
    } }, additionalProperties: false } };
    expect(adapter.validate("s", nested, { filter: { active: true, labels: ["one"] } }).ok).toBe(true);
    expect(adapter.validate("s", nested, { filter: { active: "yes" } }).ok).toBe(false);
  });

  it("rejects malformed required lists, unsafe keys, oversized and non-JSON inputs", () => {
    expect(adapter.validate("s", { name: "bad", inputSchema: { type: "object", properties: {}, required: ["missing"] } }, {}).ok).toBe(false);
    expect(adapter.validate("s", tool, { query: "x", constructor: { prototype: true } }).ok).toBe(false);
    expect(adapter.validate("s", tool, { query: "x".repeat(70_000) }).ok).toBe(false);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(adapter.validate("s", tool, circular).ok).toBe(false);
  });
});
