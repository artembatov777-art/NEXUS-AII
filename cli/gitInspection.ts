import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { err, ok, type Result } from "../src/core/result";

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 8 * 1024;
const GIT_TIMEOUT_MS = 12_000;
const GIT_COMMANDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "/git status": ["status", "--short", "--untracked-files=normal", "--ignore-submodules=all", "--no-renames", "--"],
  "/git diff": ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--color=never", "--unified=3", "--"],
  "/git diff staged": ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--no-renames", "--color=never", "--unified=3", "--"],
  "/git log": ["log", "--no-show-signature", "-n", "10", "--format=%h %s"]
});
const GIT_READONLY_CONFIG = ["-c", "core.fsmonitor=false", "-c", "maintenance.auto=false"];

function safeGitEnvironment(): NodeJS.ProcessEnv {
  // Refuse inherited GIT_DIR, GIT_WORK_TREE, GIT_CONFIG_COUNT, GIT_EXEC_PATH,
  // SSH/askpass helpers and other ambient Git overrides. No network operations
  // are supported by this adapter.
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith("GIT_") && key !== "SSH_ASKPASS") {
      clean[key] = value;
    }
  }
  return {
    ...clean,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_PAGER: "cat",
    GIT_EXTERNAL_DIFF: ""
  };
}

/**
 * Runs a fixed, read-only Git builtin without a shell, pager, hook command,
 * pathspec from the model, inherited Git config overrides, or automatic fetch.
 * Rejects truncated output instead of presenting an incomplete repository
 * view as complete.
 */
async function readGit(root: string, commandArgs: readonly string[], signal: AbortSignal): Promise<Result<string>> {
  if (signal.aborted) return err("cancelled", "Git inspection was cancelled before execution.");
  return new Promise<Result<string>>(resolve => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", [...GIT_READONLY_CONFIG, ...commandArgs], {
        cwd: root, shell: false, windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"], env: safeGitEnvironment()
      });
    } catch {
      resolve(err("provider_unavailable", "Git executable is unavailable."));
      return;
    }

    let failed: Result<never> | undefined;
    let stdoutSize = 0;
    let stderrSize = 0;
    const chunks: Buffer[] = [];
    const stop = (result: Result<never>) => {
      if (failed) return;
      failed = result;
      child.kill();
    };
    const timer = setTimeout(() =>
      stop(err("timeout", "Git inspection exceeded its 12 second timeout.")), GIT_TIMEOUT_MS);
    const abort = () => stop(err("cancelled", "Git inspection was cancelled."));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();

    child.stdout.on("data", (data: Buffer) => {
      if (failed) return;
      stdoutSize += data.byteLength;
      if (stdoutSize > MAX_OUTPUT_BYTES) {
        stop(err("tool_failed", "Git output exceeds 64 KB; no truncated results are shown."));
        return;
      }
      chunks.push(data);
    });
    child.stderr.on("data", (data: Buffer) => {
      stderrSize += data.byteLength;
      if (stderrSize > MAX_ERROR_BYTES) {
        stop(err("tool_failed", "Git returned excessive diagnostic output."));
      }
    });
    child.on("error", () => stop(err("provider_unavailable", "Git executable is unavailable.")));
    child.on("close", code => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (failed) { resolve(failed); return; }
      if (signal.aborted) { resolve(err("cancelled", "Git inspection was cancelled.")); return; }
      if (code !== 0) {
        resolve(err("tool_failed", "Git could not inspect this repository. No write action was attempted."));
        return;
      }
      resolve(ok(Buffer.concat(chunks, stdoutSize).toString("utf8")));
    });
  });
}

/**
 * Read-only CLI Git integration: selected root must itself be a real Git
 * working-tree root, never a parent repository inherited by a subdirectory.
 * This is an inspection helper, not an agent-owned process execution gateway.
 */
export async function inspectLocalGit(root: string, command: string, signal: AbortSignal): Promise<Result<string>> {
  const action = GIT_COMMANDS[command.trim()];
  if (!action || typeof root !== "string" || !isAbsolute(root) ||
      Buffer.byteLength(root, "utf8") > 4096 || /[\u0000-\u001f\u007f]/.test(root)) {
    return err("validation", "Usage: /git status | /git diff [staged] | /git log (selected repository required).");
  }
  if (signal.aborted) return err("cancelled", "Git inspection was cancelled before execution.");
  try {
    const directory = await lstat(root);
    const gitMarker = await lstat(join(root, ".git"));
    if (!directory.isDirectory() || directory.isSymbolicLink() ||
        !gitMarker.isDirectory() || gitMarker.isSymbolicLink()) {
      return err("validation", "Select a real Git working-tree root; linked or external Git metadata is not supported.");
    }
    const selected = await realpath(root);
    const discovery = await readGit(selected, ["rev-parse", "--show-toplevel"], signal);
    if (!discovery.ok) return discovery;
    const reported = discovery.value.trim();
    const actual = await realpath(reported);
    const equal = process.platform === "win32"
      ? selected.toLowerCase() === actual.toLowerCase()
      : selected === actual;
    if (!equal) return err("validation", "Selected directory is not the Git working-tree root.");

    const result = await readGit(selected, action, signal);
    if (!result.ok) return result;
    const output = result.value.trimEnd();
    if (output) return ok(output);
    return ok(command.trim() === "/git status" ? "Working tree clean."
      : command.trim() === "/git log" ? "No commits are available."
        : "No changes in the requested Git diff.");
  } catch {
    return err("validation", "Selected directory is not an accessible local Git repository.");
  }
}
