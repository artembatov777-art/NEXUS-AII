import type { AgentId } from "./agents";
import type { JsonValue } from "./agentCheckpoints";
import type { ResumableAgentDefinition } from "./resumableAgents";

export const TOOL_INVOCATION_AGENT_ID = "nexus.tool-invocation" as AgentId;

interface ToolInvocationInput {
  toolId: string;
  input: unknown;
  purpose: string;
}
interface ToolInvocationState {
  toolId: string;
  input: JsonValue;
  purpose: string;
}

function toBoundedJson(value: unknown, maxBytes: number): JsonValue {
  const encoded = JSON.stringify(value);
  if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new Error("Tool invocation data must be JSON and stay within 64 KB.");
  }
  const parsed: unknown = JSON.parse(encoded);
  const inspect = (item: unknown, depth = 0): boolean => {
    if (depth > 40) return false;
    if (item === null || typeof item === "string" || typeof item === "boolean") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (Array.isArray(item)) return item.every(child => inspect(child, depth + 1));
    if (typeof item !== "object") return false;
    return Object.entries(item).every(([key, child]) =>
      key !== "__proto__" && key !== "constructor" && key !== "prototype" && inspect(child, depth + 1)
    );
  };
  if (!inspect(parsed)) throw new Error("Tool invocation data contains unsupported JSON values.");
  return parsed as JsonValue;
}

/**
 * A bounded adapter agent: it turns one validated plan step into one Tool Gateway
 * invocation. The Gateway remains responsible for tool-specific permissions,
 * audit, timeouts, cancellation and input/output validation.
 */
export function createToolInvocationAgent(): ResumableAgentDefinition<ToolInvocationInput> {
  return {
    id: TOOL_INVOCATION_AGENT_ID,
    version: "1.0.0",
    name: "Tool invocation agent",
    description: "Executes one planned tool step through the permission-enforcing Tool Gateway.",
    requiredPermissions: ["tool:execute"],
    maxSteps: 1,
    timeoutMs: 120_000,
    createState(input) {
      if (!input || typeof input !== "object" || typeof input.toolId !== "string" ||
          !/^[a-zA-Z0-9._-]{1,120}$/.test(input.toolId) ||
          typeof input.purpose !== "string" || !input.purpose.trim() || input.purpose.length > 500) {
        throw new Error("Tool invocation identity or purpose is invalid.");
      }
      return {
        toolId: input.toolId,
        purpose: input.purpose.trim(),
        input: toBoundedJson(input.input, 64_000)
      } satisfies ToolInvocationState as unknown as JsonValue;
    },
    async step(state, context) {
      const current = state as unknown as ToolInvocationState;
      const result = await context.tools.execute<unknown>(current.toolId, current.input, {
        runId: context.runId,
        step: context.step,
        signal: context.signal
      });
      if (!result.ok) throw new Error(result.error.message);
      const safeResult = toBoundedJson(result.value, 64_000);
      const output = JSON.stringify(safeResult);
      return {
        state: { ...current, result: safeResult } as unknown as JsonValue,
        done: true,
        progress: "Completed a permission-checked tool invocation",
        output
      };
    }
  };
}
