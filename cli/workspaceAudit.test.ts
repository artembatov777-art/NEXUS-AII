import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileWorkspaceAuditSink } from "./workspaceAudit";
import type { ToolAuditEvent } from "../src/core/tools";

const started: ToolAuditEvent = {
  toolId: "cli.workspace.read", runId: "run-1",
  traceId: "step-1", status: "started", timestamp: 10
};

async function withAuditDir(fn: (path: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "nexus-cli-audit-"));
  try { await fn(join(root, "workspace-audit")); }
  finally { await rm(root, { recursive: true, force: true }); }
}

describe("durable CLI workspace audit journal", () => {
  it("persists and lists tool events in order with an explicit result limit", async () => {
    await withAuditDir(async directory => {
      const audit = new FileWorkspaceAuditSink(directory);
      expect(await audit.list({ runId: "run-1", limit: 10 })).toEqual({ ok: true, value: [] });
      expect((await audit.record(started)).ok).toBe(true);
      expect((await audit.record({ ...started, status: "completed", timestamp: 11 })).ok).toBe(true);
      expect((await audit.record({ ...started, runId: "run-2", traceId: "step-2", timestamp: 12 })).ok).toBe(true);
      expect(await audit.list({ runId: "run-1", limit: 10 }))
        .toEqual({ ok: true, value: [started, { ...started, status: "completed", timestamp: 11 }] });
      expect(await audit.list({ runId: "run-1", limit: 1 }))
        .toEqual({ ok: true, value: [{ ...started, status: "completed", timestamp: 11 }] });
      expect(await audit.list({ runId: "run-2", limit: 10 }))
        .toEqual({ ok: true, value: [{ ...started, runId: "run-2", traceId: "step-2", timestamp: 12 }] });
    });
  });

  it("refuses invalid identifiers, malformed status and control-bearing detail", async () => {
    await withAuditDir(async directory => {
      const audit = new FileWorkspaceAuditSink(directory);
      expect((await audit.record({ ...started, runId: "../escaped" })).ok).toBe(false);
      expect((await audit.record({ ...started, status: "unknown" as ToolAuditEvent["status"] })).ok).toBe(false);
      expect((await audit.record({ ...started, detail: "\u001b[31m" })).ok).toBe(false);
      expect((await audit.list({ runId: "../escaped" })).ok).toBe(false);
      expect((await audit.list({ runId: "run-1", limit: 5_001 })).ok).toBe(false);
    });
  });

  it("rejects a symlinked audit journal rather than appending to the target", async () => {
    if (process.platform === "win32") return;
    await withAuditDir(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = join(directory, "target.jsonl");
      await writeFile(target, "keep-this-unchanged\n", { mode: 0o600 });
      await symlink(target, join(directory, "run-1.jsonl"));
      const audit = new FileWorkspaceAuditSink(directory);
      expect((await audit.record(started)).ok).toBe(false);
      expect((await audit.list({ runId: "run-1" })).ok).toBe(false);
      expect(await readFile(target, "utf8")).toBe("keep-this-unchanged\n");
    });
  });

  it("blocks replay decisions when the journal contains malformed or interrupted records", async () => {
    await withAuditDir(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, "run-1.jsonl");
      await writeFile(file, JSON.stringify(started), { mode: 0o600 }); // no terminating newline
      const audit = new FileWorkspaceAuditSink(directory);
      expect((await audit.list({ runId: "run-1" })).ok).toBe(false);
      await writeFile(file, JSON.stringify(started) + "\n" + "not-json\n");
      expect((await audit.list({ runId: "run-1" })).ok).toBe(false);
      await writeFile(file, JSON.stringify({ ...started, runId: "foreign-run" }) + "\n");
      expect((await audit.list({ runId: "run-1" })).ok).toBe(false);
    });
  });

  it("bounds journal reads and refuses oversized audit files", async () => {
    await withAuditDir(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, "run-1.jsonl");
      await writeFile(file, JSON.stringify(started) + "\n");
      await truncate(file, 8 * 1024 * 1024 + 1);
      const audit = new FileWorkspaceAuditSink(directory);
      expect((await audit.list({ runId: "run-1" })).ok).toBe(false);
      expect((await audit.record(started)).ok).toBe(false);
    });
  });
});
