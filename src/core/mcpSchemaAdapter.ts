import { err, ok, type Result } from "./result";
import type { McpRemoteTool, McpToolAdapter } from "./mcpClient";

const MAX_INPUT_BYTES = 64_000;
const MAX_SCHEMA_BYTES = 32_000;
const MAX_DEPTH = 12;
const MAX_PROPERTIES = 100;
const MAX_ARRAY_ITEMS = 1_000;
type Schema = Record<string, unknown>;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validSchema(schema: unknown, depth = 0): schema is Schema {
  if (!plainObject(schema) || depth > MAX_DEPTH) return false;
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "description", "title"]);
  if (Object.keys(schema).some(key => !allowed.has(key))) return false;
  if (typeof schema.type !== "string" || !["object", "string", "number", "integer", "boolean", "array"].includes(schema.type)) return false;
  if (schema.description !== undefined && (typeof schema.description !== "string" || schema.description.length > 500)) return false;
  if (schema.title !== undefined && (typeof schema.title !== "string" || schema.title.length > 120)) return false;

  if (schema.type === "object") {
    if (!plainObject(schema.properties) || Object.keys(schema.properties).length > MAX_PROPERTIES) return false;
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") return false;
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length > MAX_PROPERTIES ||
        schema.required.some(key => typeof key !== "string" || !Object.prototype.hasOwnProperty.call(schema.properties, key)) ||
        new Set(schema.required).size !== schema.required.length)) return false;
    return Object.entries(schema.properties).every(([key, child]) =>
      key !== "__proto__" && key !== "constructor" && key !== "prototype" && validSchema(child, depth + 1)
    );
  }
  if (schema.type === "array") return validSchema(schema.items, depth + 1);
  return schema.properties === undefined && schema.required === undefined &&
    schema.additionalProperties === undefined && schema.items === undefined;
}

function validValue(value: unknown, schema: Schema, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  switch (schema.type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isSafeInteger(value);
    case "boolean": return typeof value === "boolean";
    case "array":
      return Array.isArray(value) && value.length <= MAX_ARRAY_ITEMS &&
        value.every(item => validValue(item, schema.items as Schema, depth + 1));
    case "object": {
      if (!plainObject(value)) return false;
      const properties = schema.properties as Record<string, Schema>;
      const required = (schema.required as string[] | undefined) ?? [];
      if (required.some(key => !Object.prototype.hasOwnProperty.call(value, key))) return false;
      if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.prototype.hasOwnProperty.call(properties, key))) return false;
      return Object.entries(value).every(([key, item]) =>
        key !== "__proto__" && key !== "constructor" && key !== "prototype" &&
        (!Object.prototype.hasOwnProperty.call(properties, key) ||
          validValue(item, properties[key], depth + 1))
      );
    }
    default: return false;
  }
}

/** Bounded JSON-Schema subset. Unsupported keywords and unsafe shapes fail closed. */
export class BasicMcpSchemaAdapter implements McpToolAdapter {
  validate(_serverId: string, tool: McpRemoteTool, input: unknown): Result<unknown> {
    const schema = tool.inputSchema;
    if (!schema || !plainObject(schema)) return err("validation", "MCP tool has no valid input schema.");
    try {
      const encodedSchema = JSON.stringify(schema);
      if (new TextEncoder().encode(encodedSchema).byteLength > MAX_SCHEMA_BYTES || !validSchema(schema) || schema.type !== "object") {
        return err("validation", "MCP input schema is unsupported, unsafe, or exceeds its size limit.");
      }
      const encodedInput = JSON.stringify(input);
      if (typeof encodedInput !== "string" || new TextEncoder().encode(encodedInput).byteLength > MAX_INPUT_BYTES) {
        return err("validation", "MCP tool input must be JSON and no larger than 64 KB.");
      }
      const safeInput: unknown = JSON.parse(encodedInput);
      if (!validValue(safeInput, schema)) return err("validation", "MCP tool input does not match its declared schema.");
      return ok(safeInput);
    } catch {
      return err("validation", "MCP tool schema or input is not valid JSON.");
    }
  }
}
