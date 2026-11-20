import type { ValidatedPlan } from "./agentPlanner";
import type { ToolRegistry } from "./toolRegistry";
import { err, ok, type Result } from "./result";

const MAX_EXECUTION_STEPS = 12;
const MAX_PLAN_BYTES = 64_000;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Runtime tool grants are host-owned, not plan-owned. Recheck this immediately
 * before every delegated step, including steps resumed after owner approval.
 */
export function isExecutableToolStep(
  toolId: string,
  registry: ToolRegistry,
  allowedToolIds?: readonly string[]
): boolean {
  if (typeof toolId !== "string" || !toolId.trim() || !registry.get(toolId)) return false;
  if (allowedToolIds === undefined) return true;
  if (!Array.isArray(allowedToolIds)) return false;
  return allowedToolIds.includes(toolId) ||
    (toolId.startsWith("mcp.") && allowedToolIds.includes("mcp.*"));
}

/**
 * Tool IDs are not stable capabilities. Capture the exact currently
 * registered implementation identity at dispatch, and require that it still
 * matches when a step is delegated or resumed after owner approval.
 */
export type ToolRegistrationBindings = ReadonlyMap<string, symbol>;

export function captureExecutableToolRegistrations(
  plan: ValidatedPlan,
  registry: ToolRegistry,
  allowedToolIds?: readonly string[]
): Result<ToolRegistrationBindings> {
  if (!plan || !Array.isArray(plan.steps)) {
    return err("validation", "Agent tool registrations require a valid plan.");
  }
  const registrations = new Map<string, symbol>();
  for (const step of plan.steps) {
    if (!step || !isExecutableToolStep(step.toolId, registry, allowedToolIds)) {
      return err("validation", "Planned tool is not registered or permitted.");
    }
    const token = registry.registrationToken(step.toolId);
    if (!token) return err("validation", "Planned tool has no active registration.");
    registrations.set(step.toolId, token);
  }
  return ok(registrations);
}

export function isBoundExecutableToolStep(
  toolId: string,
  registry: ToolRegistry,
  bindings: ToolRegistrationBindings,
  allowedToolIds?: readonly string[]
): boolean {
  const token = bindings.get(toolId);
  return token !== undefined && registry.registrationToken(toolId) === token &&
    isExecutableToolStep(toolId, registry, allowedToolIds);
}

/**
 * JSON is the only supported plan payload. Reject getters, exotic objects,
 * non-finite numbers, cycles, sparse arrays and prototype-pollution keys
 * before detaching untrusted input from the caller.
 */
function isPlainJson(value: unknown, depth = 0, seen = new Set<object>()): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length || Object.getOwnPropertySymbols(value).length) return false;
      return value.every((entry, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        return !!descriptor && "value" in descriptor && isPlainJson(entry, depth + 1, seen);
      });
    }
    if (Object.getOwnPropertySymbols(value).length) return false;
    return Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, descriptor]) =>
      !BLOCKED_KEYS.has(key) && descriptor.enumerable &&
      "value" in descriptor && isPlainJson(descriptor.value, depth + 1, seen));
  } finally {
    seen.delete(value);
  }
}

/**
 * Shared dispatch boundary for the CLI sequential planner and Desktop
 * checkpointed coordinator. Planner validation alone is insufficient: a
 * caller can supply a forged plan or the registry may change after planning.
 *
 * Returns a detached JSON snapshot. The host must ALSO use
 * isExecutableToolStep before each side effect because a tool may be revoked
 * after this validation while a run waits for owner approval.
 */
export function validateExecutablePlan(
  candidate: ValidatedPlan,
  registry: ToolRegistry,
  allowedToolIds?: readonly string[]
): Result<ValidatedPlan> {
  try {
    if (!isPlainJson(candidate) ||
        typeof candidate.goal !== "string" || !candidate.goal.trim() ||
        candidate.goal.length > 2_000 ||
        !Array.isArray(candidate.steps) ||
        candidate.steps.length === 0 ||
        candidate.steps.length > MAX_EXECUTION_STEPS) {
      return err("validation", "Agent execution plan is invalid or exceeds its step budget.");
    }

    const known = new Set<string>();
    for (const step of candidate.steps) {
      if (!step || typeof step.id !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(step.id) || known.has(step.id) ||
          typeof step.toolId !== "string" || !isExecutableToolStep(step.toolId, registry, allowedToolIds) ||
          typeof step.purpose !== "string" || !step.purpose.trim() ||
          step.purpose.length > 300 ||
          !Array.isArray(step.dependsOn) ||
          new Set(step.dependsOn).size !== step.dependsOn.length ||
          step.dependsOn.some(dep => typeof dep !== "string" || !known.has(dep))) {
        return err("validation", "Agent execution plan contains an invalid or unavailable tool step.");
      }
      known.add(step.id);
    }

    const serialized = JSON.stringify(candidate);
    if (typeof serialized !== "string" ||
        new TextEncoder().encode(serialized).byteLength > MAX_PLAN_BYTES) {
      return err("validation", "Agent execution plan exceeds its 64 KB limit.");
    }
    return ok(JSON.parse(serialized) as ValidatedPlan);
  } catch {
    return err("validation", "Agent execution plan must be safe serializable JSON.");
  }
}
