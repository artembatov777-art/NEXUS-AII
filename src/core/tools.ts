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
  | "shell:execute";

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
  execute(input: Input, context: ToolExecutionContext): Promise<Result<Output>>;
}

export interface ToolAuditEvent {
  toolId: string;
  runId: string;
  traceId: string;
  status: "started" | "completed" | "failed" | "denied";
  timestamp: number;
  detail?: string;
}

export interface ToolAuditSink {
  record(event: ToolAuditEvent): Promise<Result<void>>;
}

export interface ToolClock {
  now(): number;
}

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

  constructor(
    private readonly permissions: PermissionService,
    private readonly audit: ToolAuditSink,
    private readonly clock: ToolClock
  ) {}

  register<Input, Output>(definition: ToolDefinition<Input, Output>): Result<void> {
    if (!definition.id.trim() || !definition.version.trim() || !definition.description.trim()) {
      return err("validation", "Tool id, version, and description are required.");
    }
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

  list(): Array<Omit<ToolDefinition, "execute" | "validateInput">> {
    return [...this.tools.values()].map(({ execute: _execute, validateInput: _validate, ...metadata }) => metadata);
  }

  async execute<Output = unknown>(
    toolId: string,
    input: unknown,
    context: ToolExecutionContext,
    actorId: string
  ): Promise<Result<Output>> {
    const tool = this.tools.get(toolId);
    if (!tool) return err("tool_failed", `Tool "${toolId}" is not registered.`);

    if (context.signal.aborted) return err("cancelled", "Tool execution was cancelled.");
    const inputSize = serializedSize(input);
    if (inputSize === null || inputSize > MAX_INPUT_BYTES) {
      return err("validation", "Tool input must be valid JSON and no larger than 64 KB.");
    }

    const validated = tool.validateInput(input);
    if (!validated.ok) return validated;

    for (const scope of tool.requiredPermissions) {
      let decision: "allow" | "deny" | "ask_user";
      try {
        decision = await this.permissions.authorize({
          actorId,
          scope,
          resource: tool.id,
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
      if (!auditCompleted.ok) return err("storage_failed", "Tool completed, but its completion audit could not be recorded.");
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
