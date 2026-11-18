import type { ModelProvider } from "../core/model";
import { ok } from "../core/result";

export const WORKSPACE_TEST_PROVIDER = "workspace-test";
export const WORKSPACE_TEST_MODEL = "read-only";
export const WORKSPACE_TEST_TOOLS = ["workspace.list", "workspace.read", "workspace.search_content"];

export const workspaceTestProvider: ModelProvider = {
  id: WORKSPACE_TEST_PROVIDER,
  listModels: async () => ok([{
    id: WORKSPACE_TEST_MODEL,
    providerId: WORKSPACE_TEST_PROVIDER,
    displayName: "Test planner (offline read-only)",
    supportsStreaming: true,
    supportsTools: true,
    declaredLocation: "local"
  }]),
  async *stream(request) {
    if (request.signal?.aborted) throw new Error("Planning was cancelled.");
    if (request.model !== WORKSPACE_TEST_MODEL) throw new Error("Unknown workspace test model.");
    const { goal, availableTools } = JSON.parse(request.messages.at(-1)?.content ?? "{}");
    const instruction = typeof goal === "string" && /^(list|read|search)\s+(.+)$/.exec(goal);
    if (!instruction) throw new Error('Use list <absolute path>, read <absolute path>, or search {"path":"...","query":"..."}.');
    const [, operation, argument] = instruction;
    const toolId = operation === "search" ? "workspace.search_content" : `workspace.${operation}`;
    if (!Array.isArray(availableTools) || !availableTools.some(tool => tool?.id === toolId)) {
      throw new Error("The requested read tool is unavailable.");
    }
    const input: unknown = operation === "search" ? JSON.parse(argument) : { path: argument };
    yield { type: "text_delta", text: JSON.stringify({
      goal, steps: [{ id: operation, toolId, purpose: "Inspect the approved workspace", input, dependsOn: [] }]
    }) };
    if (request.signal?.aborted) throw new Error("Planning was cancelled.");
    yield { type: "completed" };
  }
};
