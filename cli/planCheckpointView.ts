import {
  validateAgentCheckpoint, type AgentCheckpoint, type AgentCheckpointRepository
} from "../src/core/agentCheckpoints";
import { quoteTerminal } from "./quote";

const THREAD_ID = "workspace-cli";
const AGENT_ID = "nexus.cli.workspace";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const USAGE = "Usage: /checkpoints [1-50] | /checkpoint <run-id>\n";

interface StepIdentity { id: string; toolId: string }
interface PlanState {
  kind: "nexus.plan-run.v1";
  steps: StepIdentity[];
  nextStep: number;
  active: (StepIdentity & { index: number }) | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stateOf(checkpoint: AgentCheckpoint): PlanState | null {
  try {
    if (validateAgentCheckpoint(checkpoint) !== null ||
        checkpoint.threadId !== THREAD_ID || checkpoint.agentId !== AGENT_ID ||
        !isRecord(checkpoint.state)) return null;
    const state = checkpoint.state;
    if (state.kind !== "nexus.plan-run.v1" ||
        !Array.isArray(state.steps) || state.steps.length < 1 || state.steps.length > 12 ||
        !Number.isSafeInteger(state.nextStep) ||
        (state.nextStep as number) < 0 ||
        (state.nextStep as number) > state.steps.length ||
        !state.steps.every(step => isRecord(step) &&
          typeof step.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(step.id) &&
          typeof step.toolId === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(step.toolId))) {
      return null;
    }
    if (state.active !== null) {
      if (!isRecord(state.active) ||
          state.active.index !== state.nextStep ||
          state.steps[state.active.index as number]?.id !== state.active.id ||
          state.steps[state.active.index as number]?.toolId !== state.active.toolId) return null;
    }
    if (checkpoint.status === "completed" &&
        (state.active !== null || state.nextStep !== state.steps.length)) return null;
    return state as unknown as PlanState;
  } catch { return null; }
}

function describe(checkpoint: AgentCheckpoint): string | null {
  const state = stateOf(checkpoint);
  if (!state) return null;
  return [
    quoteTerminal(checkpoint.runId),
    quoteTerminal(checkpoint.status),
    "checkpoint=" + checkpoint.sequence,
    "confirmed=" + state.nextStep + "/" + state.steps.length,
    ...(state.active ? ["in-flight=" + quoteTerminal(state.active.toolId) + ":" + quoteTerminal(state.active.id)] : [])
  ].join("  ");
}

/**
 * Local, read-only run inspection. A file checkpoint is not permission to
 * replay a tool, and an incomplete run can never be considered safe merely
 * because the checkpoint exists or says a step was dispatched.
 */
export async function renderPlanCheckpointCommand(
  input: string,
  repository: Pick<AgentCheckpointRepository, "get" | "listByThread">
): Promise<string | null> {
  const command = input.trim();
  if (!/^\/checkpoints?(?:\s|$)/.test(command)) return null;
  if (/^\/checkpoints(?:\s|$)/.test(command)) {
    const match = /^\/checkpoints(?: ([0-9]+))?$/.exec(command);
    if (!match) return USAGE;
    const limit = match[1] === undefined ? DEFAULT_LIMIT : Number(match[1]);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) return USAGE;
    try {
      const listed = await repository.listByThread(THREAD_ID, limit);
      if (!listed.ok || !Array.isArray(listed.value)) {
        return "Checkpoint list is unavailable or unreadable. No tool was executed.\n";
      }
      if (!listed.value.length) {
        return "No saved CLI plan checkpoints found. This is not proof of any external outcome.\n";
      }
      const lines: string[] = [];
      for (const checkpoint of listed.value.slice(0, limit)) {
        const detail = describe(checkpoint);
        if (!detail) return "Checkpoint list is unavailable or unreadable. No tool was executed.\n";
        lines.push(detail);
      }
      return "Saved CLI plan checkpoints (" + lines.length + "):\n" + lines.join("\n") +
        "\nUse /checkpoint <run-id> to inspect an interrupted plan.\n";
    } catch {
      return "Checkpoint list is unavailable or unreadable. No tool was executed.\n";
    }
  }

  const match = /^\/checkpoint ([A-Za-z0-9_-]{1,120})$/.exec(command);
  if (!match) return USAGE;
  const runId = match[1];
  try {
    const loaded = await repository.get(runId);
    if (!loaded.ok) return "Checkpoint is unavailable or unreadable. No tool was executed.\n";
    if (!loaded.value || loaded.value.threadId !== THREAD_ID ||
        loaded.value.agentId !== AGENT_ID) {
      return "No saved CLI plan checkpoint found for " + quoteTerminal(runId) + ".\n";
    }
    const checkpoint = loaded.value;
    const detail = describe(checkpoint);
    if (!detail || checkpoint.runId !== runId) {
      return "Checkpoint is unreadable or unsupported. No tool was executed.\n";
    }
    const state = stateOf(checkpoint)!;
    const caution = state.active
      ? "Dispatch of " + quoteTerminal(state.active.toolId) +
        " was recorded, but its external outcome is unconfirmed. Inspect /audit status " +
        quoteTerminal(runId) + " before any new run."
      : checkpoint.status === "completed"
        ? "The plan completion checkpoint is durable; no tool was executed by this inspection."
        : "Incomplete checkpoint: inspect /audit status " + quoteTerminal(runId) +
          " and /audit locks. Never infer a tool is safe to retry.";
    return "CLI plan checkpoint:\n" + detail + "\n" + caution + "\n";
  } catch {
    return "Checkpoint is unavailable or unreadable. No tool was executed.\n";
  }
}
