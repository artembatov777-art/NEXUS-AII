import { err, ok, type Result } from "./result";

export type PermissionScope =
  | "conversation:read"
  | "memory:read"
  | "memory:write"
  | "filesystem:read:selected"
  | "filesystem:write:selected"
  | "browser:read"
  | "browser:interact"
  | "github:read"
  | "github:write"
  | "shell:execute"
  | "mcp:execute";

export type ToolRisk = "low" | "medium" | "high";

export interface PermissionRequest {
  actorId: string;
  scope: PermissionScope;
  resource?: string;
  reason: string;
  risk: ToolRisk;
}

export interface PermissionService {
  authorize(request: PermissionRequest): Promise<"allow" | "deny" | "ask_user">;
}

export interface ToolExecutionContext {
  traceId: string;
  runId: string;
  signal: AbortSignal;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  id: string;
  version: string;
  description: string;
  requiredPermissions: PermissionScope[];
  risk: ToolRisk;
  timeoutMs: number;
  validateInput(input: unknown): Result<Input>;
  resourceForInput?(input: Input): string;
  execute(input: Input, context: ToolExecutionContext): Promise<Result<Output>>;
}

export interface ToolAuditEvent {
  toolId: string;
  runId: string;
  traceId: string;
  status: "started" | "completed" | "failed" | "denied" | "reconciled";
  timestamp: number;
  detail?: string;
}

export interface ToolAuditSink {
  record(event: ToolAuditEvent): Promise<Result<void>>;
  list?(options?: { runId?: string; limit?: number }): Promise<Result<ToolAuditEvent[]>>;
}

export interface ToolClock {
  now(): number;
}

export const MAX_TOOL_AUDIT_HISTORY_EVENTS = 5_000;

const MAX_INPUT_BYTES = 64_000;
const MAX_OUTPUT_BYTES = 64_000;

const serializedSize = (value: unknown): number | null => {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? new TextEncoder().encode(serialized).byteLength : null;
  } catch {
    return null;
  }
};

/** All tool execution must pass through this gateway. It is default-deny by construction. */
export class ToolGateway {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();
  /** Prevents concurrent callers from crossing the same run/step audit boundary. */
  private readonly activeSteps = new Set<string>();

  constructor(
    private readonly permissions: PermissionService,
    private readonly audit: ToolAuditSink,
    private readonly clock: ToolClock
  ) {}

  register<Input, Output>(definition: ToolDefinition<Input, Output>): Result<void> {
    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(definition.id) || !definition.version.trim() || !definition.description.trim() || definition.description.length > 500) {
      return err("validation", "Tool id, version, and description are invalid or exceed their limits.");
    }
    const scopes: PermissionScope[] = ["conversation:read", "memory:read", "memory:write", "filesystem:read:selected", "filesystem:write:selected", "browser:read", "browser:interact", "github:read", "github:write", "shell:execute", "mcp:execute"];
    if (!Array.isArray(definition.requiredPermissions) || definition.requiredPermissions.some(scope => !scopes.includes(scope))) {
      return err("validation", "Tool permissions contain an unsupported scope.");
    }
    if (!["low", "medium", "high"].includes(definition.risk) || typeof definition.validateInput !== "function" || typeof definition.execute !== "function") {
      return err("validation", "Tool risk, validator, or executor is invalid.");
    }
    if (definition.resourceForInput !== undefined && typeof definition.resourceForInput !== "function") return err("validation", "Tool resource resolver must be a function.");
    if (this.tools.has(definition.id)) return err("validation", `Tool "${definition.id}" is already registered.`);
    if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 100 || definition.timeoutMs > 120_000) {
      return err("validation", "Tool timeoutMs must be between 100 and 120,000.");
    }
    this.tools.set(definition.id, definition as ToolDefinition<unknown, unknown>);
    return ok(undefined);
  }

  unregister(toolId: string): void {
    this.tools.delete(toolId);
  }

  list(): Array<Omit<ToolDefinition, "execute" | "validateInput" | "resourceForInput">> {
    return [...this.tools.values()].map(({ execute: _execute, validateInput: _validate, resourceForInput: _resource, ...metadata }) => metadata);
  }

  async execute<Output = unknown>(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext,
    actorId: string
  ): Promise<Result<Output>> {
    if (typeof actorId !== "string" || !actorId.trim() || actorId.length > 160) return err("permission_denied", "A valid host actor identity is required.");
    const tool = this.tools.get(toolId);
    if (!tool) return err("tool_failed", `Tool "${toolId}" is not registered.`);

    if (context.signal.aborted) return err("cancelled", "Tool execution was cancelled.");
    const inputSize = serializedSize(input);
    if (inputSize === null || inputSize > MAX_INPUT_BYTES) {
      return err("validation", "Tool input must be valid JSON and no larger than 64 KB.");
    }

    let validated: Result<unknown>;
    try { validated = tool.validateInput(input); }
    catch { return err("validation", "Tool input validation failed unexpectedly."); }
    if (!validated.ok) return validated;

    const stepKey = JSON.stringify([context.runId, toolId, context.traceId]);
    if (this.activeSteps.has(stepKey)) {
      return err("tool_failed", "This tool step is already executing and cannot be started concurrently.");
    }
    this.activeSteps.add(stepKey);
    try {
      // A durable "started" or terminal record means this exact run/step may already
      // have crossed an external side-effect boundary. Never replay it blindly.
      if (this.audit.list) {
        let history: Result<ToolAuditEvent[]>;
        try { history = await this.audit.list({ runId: context.runId, limit: MAX_TOOL_AUDIT_HISTORY_EVENTS }); }
        catch { return err("storage_failed", "Tool execution was blocked because prior-step audit history could not be verified."); }
        if (!history.ok) return err("storage_failed", "Tool execution was blocked because prior-step audit history could not be verified.");
        const prior = history.value.find(event => event.runId === context.runId && event.toolId === toolId && event.traceId === context.traceId && event.status !== "denied");
        if (prior) return err("tool_failed", "This tool step already has an audit record and will not be replayed automatically. Review its outcome before starting a new run.");
      }
  
      let resource: string;
      try { resource = tool.resourceForInput ? tool.resourceForInput(validated.value) : tool.id; }
      catch { return err("validation", "Tool permission resource could not be resolved."); }
      if (typeof resource !== "string" || !resource.trim() || resource.length > 4096) {
        return err("validation", "Tool permission resource is invalid.");
      }
  
      for (const scope of tool.requiredPermissions) {
        let decision: "allow" | "deny" | "ask_user";
        try {
          decision = await this.permissions.authorize({
            actorId,
            scope,
            resource,
            reason: `Tool "${tool.id}" requires ${scope}.`,
            risk: tool.risk
          });
        } catch {
          await this.writeAudit(tool.id, context, "denied", "Permission service failed closed.");
          return err("permission_denied", "Permission service failed closed.");
        }
        if (decision !== "allow") {
          await this.writeAudit(tool.id, context, "denied", decision === "ask_user" ? "User approval is required." : "Permission denied.");
          return err("permission_denied", decision === "ask_user" ? "Tool requires explicit user approval." : "Tool permission was denied.");
        }
      }
  
      const auditStarted = await this.writeAudit(tool.id, context, "started");
      if (!auditStarted.ok) return err("storage_failed", "Tool execution was blocked because the audit event could not be recorded.");
      if (context.signal.aborted) {
        await this.writeAudit(tool.id, context, "failed", "Cancelled before execution.");
        return err("cancelled", "Tool execution was cancelled.");
      }
  
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      context.signal.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, tool.timeoutMs);
      try {
        const execution = tool.execute(validated.value, { ...context, signal: controller.signal });
        const timeoutResult = new Promise<never>((_, reject) => {
          const onControllerAbort = () => reject(new Error(timedOut ? "Tool execution timed out." : "Tool execution was cancelled."));
          controller.signal.addEventListener("abort", onControllerAbort, { once: true });
        });
        const result = await Promise.race([execution, timeoutResult]);
        if (!result.ok) {
          await this.writeAudit(tool.id, context, "failed", result.error.code);
          return result;
        }
        const outputSize = serializedSize(result.value);
        if (outputSize === null || outputSize > MAX_OUTPUT_BYTES) {
          await this.writeAudit(tool.id, context, "failed", "Output exceeded 64 KB or was not serializable.");
          return err("tool_failed", "Tool output must be valid JSON and no larger than 64 KB.");
        }
        const auditCompleted = await this.writeAudit(tool.id, context, "completed");
        if (!auditCompleted.ok) {
          return err(
            "side_effect_completed_audit_failed",
            "The tool completed successfully, but its completion audit could not be persisted. Do not automatically retry: the side effect may already have happened."
          );
        }
        return result as Result<Output>;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Tool execution failed.";
        const cancelled = context.signal.aborted || (!timedOut && controller.signal.aborted);
        const code = timedOut ? "timeout" : cancelled ? "cancelled" : "tool_failed";
        await this.writeAudit(tool.id, context, "failed", code);
        return err(code, message, code === "timeout");
      } finally {
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", onAbort);
      }
      } finally {
        this.activeSteps.delete(stepKey);
      }
    }
  

  private async writeAudit(toolId: string, context: ToolExecutionContext, status: ToolAuditEvent["status"], detail?: string): Promise<Result<void>> {
    try {
      return await this.audit.record({
        toolId,
        runId: context.runId,
        traceId: context.traceId,
        status,
        timestamp: this.clock.now(),
        ...(detail ? { detail } : {})
      });
    } catch {
      return err("storage_failed", "Audit sink failed.");
    }
  }
}
