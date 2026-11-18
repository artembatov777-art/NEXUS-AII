import { err, ok, type Result } from "./result";
import type { AgentId } from "./agents";
import type { ResumableAgentRuntime } from "./resumableAgents";
import type { AgentTaskExecutor } from "./multiAgentCoordinator";

const MAX_OUTPUT_BYTES = 64_000;

/** Adapts the checkpointed agent runtime to the coordinator without bypassing permissions. */
export class ResumableAgentTaskExecutor implements AgentTaskExecutor {
  constructor(private readonly runtime: ResumableAgentRuntime, private readonly threadId: string) {}

  async execute(agentId: AgentId, input: unknown, signal: AbortSignal): Promise<Result<unknown>> {
    const output: string[] = [];
    let completed = false;
    try {
      for await (const event of this.runtime.start(agentId, input, this.threadId, signal)) {
        if (event.type === "output") {
          output.push(event.content);
          if (new TextEncoder().encode(output.join("\n")).byteLength > MAX_OUTPUT_BYTES) {
            return err("validation", "Delegated agent output exceeded the 64 KB limit.");
          }
        }
        if (event.type === "waiting_for_approval") {
          return err("permission_denied", `Delegated agent requires approval: ${event.permission}`);
        }
        if (event.type === "failed") return err("tool_failed", event.message);
        if (event.type === "completed") completed = true;
      }
    } catch (cause) {
      return err(signal.aborted ? "cancelled" : "tool_failed",
        cause instanceof Error ? cause.message : "Delegated agent failed.");
    }
    if (signal.aborted) return err("cancelled", "Delegated agent was cancelled.");
    if (!completed) return err("tool_failed", "Delegated agent ended without completion.");
    const encoded = output.join("\n");
    if (new TextEncoder().encode(encoded).byteLength > MAX_OUTPUT_BYTES) {
      return err("validation", "Delegated agent output exceeded the 64 KB limit.");
    }
    try {
      return ok(JSON.parse(encoded) as unknown);
    } catch {
      return ok(encoded);
    }
  }
}
