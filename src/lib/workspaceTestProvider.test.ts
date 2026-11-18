import { describe, expect, it } from "vitest";
import { AgentPlanner } from "../core/agentPlanner";
import { ModelRouter } from "../core/model";
import { ModelRouterPlanner } from "../core/modelPlanner";
import type { ToolDescriptor } from "../core/toolRegistry";
import { WORKSPACE_TEST_MODEL, WORKSPACE_TEST_PROVIDER, workspaceTestProvider } from "./workspaceTestProvider";

const searchTool: ToolDescriptor = {
  id: "workspace.search_content", version: "1", description: "search", requiredPermissions: ["filesystem:read:selected"],
  risk: "low", timeoutMs: 1000, source: "builtin", tags: []
};

function planner() {
  const router = new ModelRouter();
  router.register(workspaceTestProvider);
  return new AgentPlanner(new ModelRouterPlanner(router, WORKSPACE_TEST_PROVIDER, WORKSPACE_TEST_MODEL), 1);
}

describe("offline workspace test provider", () => {
  it("produces a bounded search plan for the supplied native workspace tool", async () => {
    const goal = 'search {"path":"C:/workspace/project","query":"fixture"}';
    const result = await planner().plan(goal, [searchTool], new AbortController().signal);
    expect(result).toMatchObject({
      ok: true, value: { goal, steps: [{ toolId: "workspace.search_content", input: { path: "C:/workspace/project", query: "fixture" } }] }
    });
  });

  it("refuses writes, shell goals, unregistered reads and cancelled requests", async () => {
    const signal = new AbortController().signal;
    for (const goal of ["write C:/workspace/file", "shell ver", "read C:/workspace/file"]) {
      expect((await planner().plan(goal, [searchTool], signal)).ok).toBe(false);
    }
    expect(await planner().plan('search {"path":"C:/workspace","query":"a"}', [searchTool], AbortSignal.abort()))
      .toMatchObject({ ok: false, error: { code: "cancelled" } });
  });
});
