import type { AgentRunId } from "./agents";
import type { ToolGateway } from "./tools";
import { err, type Result } from "./result";

export interface AgentToolContext {
  runId: AgentRunId;
  step: number;
  signal: AbortSignal;
}

export interface AgentToolExecutor {
  execute<Output = unknown>(toolId: string, input: unknown, context: AgentToolContext): Promise<Result<Output>>;
}

/**
 * Bridges resumable agent steps to the permission-enforcing ToolGateway.
 * It deliberately accepts an actor identity from the host composition root;
 * an agent cannot choose or escalate its own actor identity.
 */
export class GatewayAgentToolExecutor implements AgentToolExecutor {
  constructor(private readonly gateway: ToolGateway, private readonly actorId: string) {}

  execute<Output = unknown>(toolId: string, input: unknown, context: AgentToolContext): Promise<Result<Output>> {
    if (!this.actorId.trim() || this.actorId.length > 160) {
      return Promise.resolve(err("permission_denied", "A valid host actor identity is required."));
    }
    if (!toolId.trim() || toolId.length > 160 || !Number.isSafeInteger(context.step) || context.step < 1) {
      return Promise.resolve(err("validation", "Agent tool invocation context is invalid."));
    }
    if (context.signal.aborted) {
      return Promise.resolve(err("cancelled", "Agent tool invocation was cancelled."));
    }
    const traceId = `${context.runId}:${context.step}`.slice(0, 160);
    return this.gateway.execute<Output>(toolId, input, {
      runId: context.runId,
      traceId,
      signal: context.signal
    }, this.actorId);
  }
}
