import { describe, expect, it, vi } from "vitest";
import { ToolGateway } from "../src/core/tools";
import { ok } from "../src/core/result";
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, utimes, writeFile, access } from "node:fs/promises";
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

  it("discovers recent run IDs without needing to know the audit file name", async () => {
    await withAuditDir(async directory => {
      const audit = new FileWorkspaceAuditSink(directory);
      expect(await audit.recent()).toEqual({ ok: true, value: [] });
      expect((await audit.record(started)).ok).toBe(true);
      expect((await audit.record({ ...started, runId: "run-2" })).ok).toBe(true);
      await utimes(join(directory, "run-1.jsonl"), new Date(1000), new Date(1000));
      await utimes(join(directory, "run-2.jsonl"), new Date(2000), new Date(2000));
      await writeFile(join(directory, "ignored.edit.json"), "not a tool journal", { mode: 0o600 });
      const recent = await audit.recent(2);
      expect(recent.ok && recent.value.map(item => item.runId)).toEqual(["run-2", "run-1"]);
      const limited = await audit.recent(1);
      expect(limited.ok && limited.value.map(item => item.runId)).toEqual(["run-2"]);
      expect((await audit.recent(51)).ok).toBe(false);
    });
  });

  it("does not silently include symlinked run journals in recent discovery", async () => {
    if (process.platform === "win32") return;
    await withAuditDir(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const target = join(directory, "other.txt");
      await writeFile(target, "unrelated", { mode: 0o600 });
      await symlink(target, join(directory, "run-9.jsonl"));
      const audit = new FileWorkspaceAuditSink(directory);
      expect((await audit.recent()).ok).toBe(false);
    });
  });

  it("prevents ToolGateway from executing when the prior run audit is corrupted", async () => {
    await withAuditDir(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, "run-1.jsonl"), '{"status":"truncated"\n', { mode: 0o600 });
      const permissions = { authorize: vi.fn(async () => "allow" as const) };
      const execute = vi.fn(async () => ok({ result: "should not run" }));
      const audit = new FileWorkspaceAuditSink(directory);
      const gateway = new ToolGateway(permissions, audit, { now: () => 100 });
      expect(gateway.register({
        id: "test.read", version: "1", description: "Safe test tool",
        requiredPermissions: [], risk: "low", timeoutMs: 1_000,
        validateInput: () => ok({}),
        execute
      }).ok).toBe(true);
      const result = await gateway.execute("test.read", {}, {
        runId: "run-1", traceId: "step-1", signal: new AbortController().signal
      }, "owner");
      expect(result).toMatchObject({ ok: false, error: { code: "storage_failed" } });
      expect(execute).not.toHaveBeenCalled();
      expect(permissions.authorize).not.toHaveBeenCalled();
    });
  });

  it("atomically claims a run step across distinct audit writer instances", async () => {
    await withAuditDir(async directory => {
      const first = new FileWorkspaceAuditSink(directory);
      const second = new FileWorkspaceAuditSink(directory);
      const results = await Promise.all([first.record(started), second.record(started)]);
      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(results.filter(result => !result.ok)).toHaveLength(1);
      expect(await first.list({ runId: "run-1", limit: 10 }))
        .toEqual({ ok: true, value: [started] });
      await expect(access(join(directory, "run-1.jsonl.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      expect((await second.record(started)).ok).toBe(false);
    });
  });

  it("rejects a malformed earlier event rather than appending a valid started record", async () => {
    await withAuditDir(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, "run-1.jsonl");
      await writeFile(path, '{"untrusted":"record"}\n', { mode: 0o600 });
      const audit = new FileWorkspaceAuditSink(directory);
      const original = await readFile(path, "utf8");
      expect((await audit.record(started)).ok).toBe(false);
      expect(await readFile(path, "utf8")).toBe(original);
    });
  });

  it("fails closed when another writer crashed leaving a lock file", async () => {
    await withAuditDir(async directory => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const locked = join(directory, "run-1.jsonl.lock");
      await writeFile(locked, "stale lock\n", { flag: "wx", mode: 0o600 });
      const audit = new FileWorkspaceAuditSink(directory);
      expect((await audit.record(started)).ok).toBe(false);
      expect(await readFile(locked, "utf8")).toBe("stale lock\n");
      expect(await audit.list({ runId: "run-1" })).toEqual({ ok: true, value: [] });
    });
  });

  it("prevents concurrent ToolGateway instances from executing the same audited step", async () => {
    await withAuditDir(async directory => {
      const permissions = { authorize: vi.fn(async () => "allow" as const) };
      const executed = vi.fn(async () => ok({ value: "one side effect" }));
      const gateway = () => {
        const instance = new ToolGateway(permissions, new FileWorkspaceAuditSink(directory), { now: () => 123 });
        expect(instance.register({
          id: "test.claim", version: "1", description: "A deliberately replay-sensitive test",
          requiredPermissions: [], risk: "high", timeoutMs: 3_000,
          validateInput: () => ok({}),
          execute: executed
        }).ok).toBe(true);
        return instance;
      };
      const [a, b] = [gateway(), gateway()];
      const options = { runId: "run-1", traceId: "step-claim", signal: new AbortController().signal };
      const results = await Promise.all([
        a.execute("test.claim", {}, options, "owner"),
        b.execute("test.claim", {}, options, "owner")
      ]);
      expect(results.filter(result => result.ok)).toHaveLength(1);
      expect(executed).toHaveBeenCalledTimes(1);
      const journal = await new FileWorkspaceAuditSink(directory).list({ runId: "run-1", limit: 10 });
      expect(journal.ok && journal.value.some(event => event.status === "started")).toBe(true);
    });
  });
});
