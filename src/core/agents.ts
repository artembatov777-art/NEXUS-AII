import { err, ok, type Result } from "./result";

export type AgentId = string & { readonly __brand: "AgentId" };
export type AgentRunId = string & { readonly __brand: "AgentRunId" };
export type AgentPermission = "memory:read" | "conversation:read" | "tool:execute";

export interface AgentPermissionService {
  authorize(input: {
    agentId: AgentId;
    permission: AgentPermission;
    reason: string;
  }): Promise<"allow" | "deny" | "ask_user">;
}

export interface AgentClock {
  now(): number;
}

export interface AgentIdFactory {
  runId(): AgentRunId;
}

export interface AgentContext {
  readonly runId: AgentRunId;
  readonly signal: AbortSignal;
  /** Call before each meaningful unit of work. Throws when the run budget is exhausted. */
  checkpoint(label: string): void;
}

export type AgentOutputEvent =
  | { type: "progress"; label: string }
  | { type: "output"; content: string };

export interface AgentDefinition<Input = unknown> {
  id: AgentId;
  version: string;
  name: string;
  description: string;
  requiredPermissions: AgentPermission[];
  maxSteps: number;
  timeoutMs: number;
  execute(input: Input, context: AgentContext): AsyncIterable<AgentOutputEvent>;
}

export type AgentRunEvent =
  | { type: "started"; runId: AgentRunId; agentId: AgentId }
  | { type: "progress"; runId: AgentRunId; step: number; maxSteps: number; label: string }
  | { type: "output"; runId: AgentRunId; content: string }
  | { type: "waiting_for_approval"; runId: AgentRunId; permission: AgentPermission }
  | { type: "completed"; runId: AgentRunId; steps: number }
  | { type: "failed"; runId: AgentRunId; code: "validation" | "permission_denied" | "timeout" | "cancelled" | "internal"; message: string };

class AgentExecutionError extends Error {
  constructor(
    readonly code: "timeout" | "cancelled" | "validation",
    message: string
  ) {
    super(message);
  }
}

/**
 * A deliberately small, provider-neutral runtime.
 * Agents receive only a bounded context, never raw filesystem/network/shell access.
 */
export class AgentRuntime {
  private readonly agents = new Map<AgentId, AgentDefinition<unknown>>();

  constructor(
    private readonly permissions: AgentPermissionService,
    private readonly ids: AgentIdFactory,
    private readonly clock: AgentClock
  ) {}

  register<Input>(definition: AgentDefinition<Input>): Result<void> {
    if (!definition.id.trim() || !definition.name.trim() || !definition.version.trim()) {
      return err("validation", "Agent id, name, and version are required.");
    }
    if (this.agents.has(definition.id)) {
      return err("validation", `Agent "${definition.id}" is already registered.`);
    }
    if (!Number.isInteger(definition.maxSteps) || definition.maxSteps < 1 || definition.maxSteps > 100) {
      return err("validation", "Agent maxSteps must be an integer between 1 and 100.");
    }
    if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 1_000 || definition.timeoutMs > 600_000) {
      return err("validation", "Agent timeoutMs must be between 1,000 and 600,000.");
    }
    this.agents.set(definition.id, definition as AgentDefinition<unknown>);
    return ok(undefined);
  }

  unregister(agentId: AgentId): void {
    this.agents.delete(agentId);
  }

  list(): Array<Pick<AgentDefinition, "id" | "version" | "name" | "description" | "requiredPermissions" | "maxSteps" | "timeoutMs">> {
    return [...this.agents.values()].map(({ execute: _execute, ...metadata }) => metadata);
  }

  async *run<Input>(agentId: AgentId, input: Input, signal?: AbortSignal): AsyncIterable<AgentRunEvent> {
    const runId = this.ids.runId();
    const agent = this.agents.get(agentId) as AgentDefinition<Input> | undefined;
    if (!agent) {
      yield { type: "failed", runId, code: "validation", message: `Agent "${agentId}" is not registered.` };
      return;
    }

    if (signal?.aborted) {
      yield { type: "failed", runId, code: "cancelled", message: "Agent run was cancelled." };
      return;
    }

    for (const permission of agent.requiredPermissions) {
      let decision: "allow" | "deny" | "ask_user";
      try {
        decision = await this.permissions.authorize({
          agentId,
          permission,
          reason: `Agent "${agent.name}" requires ${permission}.`
        });
      } catch {
        yield { type: "failed", runId, code: "permission_denied", message: "Permission service failed closed." };
        return;
      }
      if (decision !== "allow") {
        if (decision === "ask_user") {
          yield { type: "waiting_for_approval", runId, permission };
        }
        yield { type: "failed", runId, code: "permission_denied", message: "Required permission was not granted." };
        return;
      }
    }

    const controller = new AbortController();
    const startedAt = this.clock.now();
    let steps = 0;
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, agent.timeoutMs);
    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => {
        reject(new AgentExecutionError(
          timedOut ? "timeout" : "cancelled",
          timedOut ? "Agent execution timed out." : "Agent run was cancelled."
        ));
      }, { once: true });
    });

    const context: AgentContext = {
      runId,
      signal: controller.signal,
      checkpoint: (label: string) => {
        if (controller.signal.aborted) {
          throw new AgentExecutionError(timedOut ? "timeout" : "cancelled", timedOut ? "Agent execution timed out." : "Agent run was cancelled.");
        }
        if (this.clock.now() - startedAt >= agent.timeoutMs) {
          timedOut = true;
          controller.abort();
          throw new AgentExecutionError("timeout", "Agent execution timed out.");
        }
        if (steps >= agent.maxSteps) {
          throw new AgentExecutionError("validation", "Agent step budget exhausted.");
        }
        if (!label.trim() || label.length > 200) {
          throw new AgentExecutionError("validation", "Checkpoint labels must contain 1 to 200 characters.");
        }
        steps += 1;
      }
    };

    yield { type: "started", runId, agentId };
    let iterator: AsyncIterator<AgentOutputEvent> | undefined;
    try {
      iterator = agent.execute(input, context)[Symbol.asyncIterator]();
      while (true) {
        const next = await Promise.race([iterator.next(), abortPromise]);
        if (next.done) break;
        if (next.value.type === "progress") {
          if (!next.value.label.trim() || next.value.label.length > 200) {
            throw new AgentExecutionError("validation", "Progress labels must contain 1 to 200 characters.");
          }
          yield { type: "progress", runId, step: steps, maxSteps: agent.maxSteps, label: next.value.label };
        } else if (next.value.type === "output") {
          if (next.value.content.length > 20_000) {
            throw new AgentExecutionError("validation", "Agent output exceeded the 20,000 character limit.");
          }
          yield { type: "output", runId, content: next.value.content };
        }
      }
      yield { type: "completed", runId, steps };
    } catch (cause) {
      const code = cause instanceof AgentExecutionError ? cause.code : "internal";
      const message = cause instanceof Error ? cause.message : "Unexpected agent error.";
      yield { type: "failed", runId, code, message };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onExternalAbort);
      if (controller.signal.aborted) void iterator?.return?.();
    }
  }
}
