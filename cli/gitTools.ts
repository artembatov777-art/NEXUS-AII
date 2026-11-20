import { err, ok, type Result } from "../src/core/result";
import type { ToolRegistry } from "../src/core/toolRegistry";
import { inspectLocalGit } from "./gitInspection";

interface GitRootInput { root: string }
const ACTIONS = [
  { id: "cli.git.status", command: "/git status", description: "Inspect local Git changes" },
  { id: "cli.git.diff", command: "/git diff", description: "Inspect local unstaged Git diff" },
  { id: "cli.git.diff-staged", command: "/git diff staged", description: "Inspect local staged Git diff" },
  { id: "cli.git.log", command: "/git log", description: "Inspect recent local Git commit history" }
] as const;

/** Maps only exact, user-visible read commands to registered Gateway tools. */
export function gitToolIdForCommand(command: string): string | null {
  return ACTIONS.find(action => action.command === command.trim())?.id ?? null;
}

function validateGitRoot(input: unknown, selectedRoot: () => string | null): Result<GitRootInput> {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return err("validation", "A selected Git project is required.");
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.keys(descriptors).length !== 1 ||
        !descriptors.root || !("value" in descriptors.root) ||
        typeof descriptors.root.value !== "string") {
      return err("validation", "Git input may contain only the selected project root.");
    }
    const liveRoot = selectedRoot();
    if (!liveRoot || descriptors.root.value !== liveRoot) {
      return err("permission_denied", "The selected project changed or is unavailable.");
    }
    return ok({ root: liveRoot });
  } catch {
    return err("permission_denied", "The Git workspace grant could not be validated.");
  }
}

/**
 * Git is a normal Tool Gateway capability, not a second permission system.
 * The owner selects a workspace; the Gateway must authorize the read, record
 * its durable trace, and enforce cancellation. Recheck root after permission
 * approval since the selected workspace may change while awaiting consent.
 */
export function registerCliGitTools(registry: ToolRegistry, selectedRoot: () => string | null): void {
  for (const action of ACTIONS) {
    const registered = registry.register<GitRootInput, string>({
      id: action.id,
      version: "1",
      description: action.description,
      requiredPermissions: ["filesystem:read:selected"],
      risk: "medium",
      timeoutMs: 30_000,
      validateInput: input => validateGitRoot(input, selectedRoot),
      resourceForInput: input => input.root,
      execute: async (input, context) => {
        if (context.signal.aborted) return err("cancelled", "Git inspection was cancelled.");
        let liveRoot: string | null;
        try { liveRoot = selectedRoot(); }
        catch { liveRoot = null; }
        if (!liveRoot || liveRoot !== input.root) {
          return err("permission_denied",
            "Git inspection stopped because the selected project changed during approval.");
        }
        return inspectLocalGit(input.root, action.command, context.signal);
      }
    }, "builtin", ["git", "read-only"]);
    if (!registered.ok) throw new Error(registered.error.message);
  }
}
