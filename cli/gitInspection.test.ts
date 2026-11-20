import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { inspectLocalGit } from "./gitInspection";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, windowsHide: true });
}

async function fixture(test: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "nexus-git-inspect-"));
  try {
    git(root, "init", "--quiet");
    await writeFile(join(root, "readme.txt"), "original\n");
    git(root, "add", "--", "readme.txt");
    git(root, "-c", "user.name=NEXUS Test", "-c", "user.email=nexus@example.invalid",
      "commit", "--quiet", "-m", "Initial commit");
    await test(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("read-only selected-project Git inspection", () => {
  it("shows modified and untracked files without staging or changing the index", async () => {
    await fixture(async root => {
      await writeFile(join(root, "readme.txt"), "modified\n");
      await writeFile(join(root, "new file.txt"), "untracked\n");
      const before = await readFile(join(root, ".git", "index"));
      const result = await inspectLocalGit(root, "/git status", new AbortController().signal);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toContain("readme.txt");
      expect(result.value).toContain("new file.txt");
      expect(result.value).toMatch(/M|modified/i);
      expect(await readFile(join(root, ".git", "index"))).toEqual(before);
      expect(git(root, "diff", "--cached", "--name-only").trim()).toBe("");
    });
  });

  it("shows unstaged and staged diffs separately and defaults to no external tools", async () => {
    await fixture(async root => {
      await writeFile(join(root, "readme.txt"), "stage-version\n");
      git(root, "add", "--", "readme.txt");
      await writeFile(join(root, "readme.txt"), "working-version\n");
      const staged = await inspectLocalGit(root, "/git diff staged", new AbortController().signal);
      const working = await inspectLocalGit(root, "/git diff", new AbortController().signal);
      expect(staged.ok && staged.value).toContain("+stage-version");
      expect(working.ok && working.value).toContain("+working-version");
      expect(working.ok && working.value).toContain("-stage-version");
    });
  });

  it("provides bounded recent history and no Git mutation commands", async () => {
    await fixture(async root => {
      const output = await inspectLocalGit(root, "/git log", new AbortController().signal);
      expect(output.ok && output.value).toContain("Initial commit");
      for (const command of [
        "/git commit", "/git reset --hard", "/git push", "/git status --ignored",
        "/git diff ../../secrets", "/git log --all", "/git", "/git diff staged -R"
      ]) expect(await inspectLocalGit(root, command, new AbortController().signal))
        .toMatchObject({ ok: false, error: { code: "validation" } });
    });
  });

  it("requires the selected directory itself to be the Git repository root", async () => {
    await fixture(async root => {
      const sub = join(root, "subfolder");
      await mkdir(sub);
      const result = await inspectLocalGit(sub, "/git status", new AbortController().signal);
      expect(result).toMatchObject({ ok: false, error: { code: "validation" } });
    });
  });

  it("rejects non-Git directories and a symlinked selected root", async () => {
    await fixture(async root => {
      const plain = await mkdtemp(join(tmpdir(), "nexus-no-git-"));
      try {
        const result = await inspectLocalGit(plain, "/git status", new AbortController().signal);
        expect(result.ok).toBe(false);
        if (process.platform !== "win32") {
          const indirect = join(plain, "project-link");
          await symlink(root, indirect);
          const linked = await inspectLocalGit(indirect, "/git status", new AbortController().signal);
          expect(linked).toMatchObject({ ok: false, error: { code: "validation" } });
        }
      } finally { await rm(plain, { recursive: true, force: true }); }
    });
  });

  it("honors a pre-aborted signal without inspecting a repository", async () => {
    await fixture(async root => {
      const controller = new AbortController();
      controller.abort();
      expect(await inspectLocalGit(root, "/git status", controller.signal))
        .toMatchObject({ ok: false, error: { code: "cancelled" } });
    });
  });

  it("does not leak a truncated diff as if it were complete", async () => {
    await fixture(async root => {
      await writeFile(join(root, "readme.txt"), Array.from({ length: 17_000 },
        (_, i) => "line-" + String(i).padStart(6, "0")).join("\n"));
      const result = await inspectLocalGit(root, "/git diff", new AbortController().signal);
      expect(result).toMatchObject({ ok: false, error: { code: "tool_failed" } });
    });
  });

  it("ignores inherited GIT_DIR/GIT_WORK_TREE injection", async () => {
    await fixture(async root => {
      const before = process.env.GIT_DIR;
      const beforeWork = process.env.GIT_WORK_TREE;
      try {
        process.env.GIT_DIR = join(root, "not-a-real-git-dir");
        process.env.GIT_WORK_TREE = join(root, "not-a-real-worktree");
        const status = await inspectLocalGit(root, "/git status", new AbortController().signal);
        expect(status.ok).toBe(true);
      } finally {
        if (before === undefined) delete process.env.GIT_DIR;
        else process.env.GIT_DIR = before;
        if (beforeWork === undefined) delete process.env.GIT_WORK_TREE;
        else process.env.GIT_WORK_TREE = beforeWork;
      }
    });
  });

  it("rejects a symlinked Git control directory rather than trusting it", async () => {
    if (process.platform === "win32") return;
    await fixture(async root => {
      // Bare Git control metadata linked elsewhere is not a safe selected
      // workspace even if ordinary Git itself accepts such a repository.
      const gitdir = join(root, ".git");
      const shifted = join(root, ".git-shifted");
      const { rename } = await import("node:fs/promises");
      await rename(gitdir, shifted);
      await symlink(shifted, gitdir);
      expect((await lstat(gitdir)).isSymbolicLink()).toBe(true);
      expect((await inspectLocalGit(root, "/git status", new AbortController().signal)).ok).toBe(false);
    });
  });
});
