import type { AgentId } from "../core/agents";
import type { ResumableAgentDefinition } from "../core/resumableAgents";
import { err, ok, type Result } from "../core/result";
import { DEFAULT_AGENT_PROFILE, type AgentProfile } from "./agentProfile";

export const BUILT_IN_AGENT_IDS = {
  localWorkflow: "nexus.local-workflow" as AgentId
} as const;

export const BUILT_IN_AGENT_CATALOG = [
  {
    id: BUILT_IN_AGENT_IDS.localWorkflow,
    name: "Local workflow demo",
    version: "1.0.0",
    description: "Runs a bounded local workflow through the Tool Gateway. It does not call an LLM or access external systems.",
    requiredPermissions: ["tool:execute"] as const,
    maxSteps: 3,
    timeoutMs: 15_000
  }
] as const;

interface PreviewInput { task: string }
interface PreviewOutput { preview: string }
interface WorkflowState { task: string; preview?: string }

function validatePreviewInput(input: unknown): Result<PreviewInput> {
  if (!input || typeof input !== "object" || !("task" in input) ||
      typeof input.task !== "string" || !input.task.trim() || input.task.length > 1_000) {
    return err("validation", "A task between 1 and 1,000 characters is required.");
  }
  return ok({ task: input.task.trim() });
}

export function createLocalWorkflowDefinition(profile: AgentProfile = DEFAULT_AGENT_PROFILE): ResumableAgentDefinition<string> {
  return {
    id: BUILT_IN_AGENT_IDS.localWorkflow,
    version: "1." + profile.revision + ".0",
    name: profile.name,
    description: "Runs a bounded local workflow through the Tool Gateway. It does not call an LLM or access external systems.",
    requiredPermissions: ["tool:execute"],
    maxSteps: profile.maxSteps,
    timeoutMs: profile.timeoutMs,
    createState: task => {
      if (typeof task !== "string" || !task.trim() || task.length > 1_000) throw new Error("Task must contain 1 to 1,000 characters.");
      return { task: task.trim() } satisfies WorkflowState;
    },
    async step(state, context) {
      const current = state as unknown as WorkflowState;
      const result = await context.tools.execute<PreviewOutput>("workspace.preview", { task: current.task }, {
        runId: context.runId, step: context.step, signal: context.signal
      });
      if (!result.ok) throw new Error(result.error.message);
      return {
        state: { task: current.task, preview: result.value.preview },
        done: true,
        progress: "Prepared a local, non-destructive preview",
        output: result.value.preview
      };
    }
  };
}

export function registerBuiltInAgentSuite(
  runtime: Pick<ReturnType<typeof import("./nexusRuntime").createNexusRuntime>, "agentRuntime" | "toolGateway">,
  profile: AgentProfile = DEFAULT_AGENT_PROFILE
): Result<void> {
  const tool = runtime.toolGateway.register<PreviewInput, PreviewOutput>({
    id: "workspace.preview",
    version: "1.0.0",
    description: "Create a local, non-destructive preview of a task.",
    requiredPermissions: [],
    risk: "low",
    timeoutMs: 2_000,
    validateInput: validatePreviewInput,
    execute: async input => ok({
      preview: [
        "Local workflow preview",
        "",
        "Task: " + input.task,
        "",
        "1. Clarify the expected outcome.",
        "2. Break the work into small, verifiable actions.",
        "3. Review the result before taking any external action.",
        "",
        "This preview was generated locally. No model, network, file, or system action was used."
      ].join("\n")
    })
  });
  if (!tool.ok) return tool;
  return runtime.agentRuntime.register(createLocalWorkflowDefinition(profile));
}
