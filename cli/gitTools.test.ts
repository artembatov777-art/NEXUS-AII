import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToolGateway, type ToolAuditEvent } from "../src/core/tools";
import { ToolRegistry } from "../src/core/toolRegistry";
import { ok } from "../src/core/result";
import { registerCliGitTools } from "./gitTools";
import { inspectLocalGit } from "./gitInspection";

vi.mock("./gitInspection", () => ({
  inspectLocalGit: vi.fn(async () => ({ ok: true, value: "M readme.txt" }))
}));

const root = "C:\\approved-project";
const context = (runId: string) => ({
  runId, traceId: runId + ":git", signal: new AbortController().signal
});

function setup(authorize: () => Promise<"allow" | "deny"> = async () => "allow") {
  let selectedRoot = root;
  const events: ToolAuditEvent[] = [];
  const permissions = { authorize: vi.fn(authorize) };
  const audit = {
    record: vi.fn(async (event: ToolAuditEvent) => {
      events.push(event);
      return ok(undefined);
    }),
    list: vi.fn(async (options?: { runId?: string }) =>
      ok(events.filter(event => options?.runId === undefined || event.runId === options.runId)))
  };
  const gateway = new ToolGateway(permissions, audit, { now: () => 100 });
  const registry = new ToolRegistry(gateway);
  registerCliGitTools(registry, () => selectedRoot);
  return { registry, gateway, events, permissions, select: (next: string) => { selectedRoot = next; } };
}

beforeEach(() => vi.mocked(inspectLocalGit).mockClear());

describe("Gateway-gated CLI Git inspection", () => {
  it("registers only the fixed read-only operations with filesystem permission", () => {
    const { registry } = setup();
    const names = registry.search("cli.git", 20);
    expect(names.ok).toBe(true);
    if (!names.ok) return;
    expect(names.value.map(tool => tool.id).sort()).toEqual([
      "cli.git.diff", "cli.git.diff-staged", "cli.git.log", "cli.git.status"
    ]);
    expect(names.value.every(tool => tool.requiredPermissions.includes("filesystem:read:selected"))).toBe(true);
    expect(names.value.some(tool => tool.id.includes("commit") || tool.id.includes("push"))).toBe(false);
  });

  it("blocks an unselected or forged repository root before owner permission is requested", async () => {
    const { gateway, permissions } = setup();
    const result = await gateway.execute("cli.git.status", { root: "/outside" },
      context("git-forged"), "owner");
    expect(result).toMatchObject({ ok: false });
    expect(permissions.authorize).not.toHaveBeenCalled();
    expect(inspectLocalGit).not.toHaveBeenCalled();
    for (const input of [{ root, command: "push" }, { root: "" }, null, { root: 1 }]) {
      expect((await gateway.execute("cli.git.status", input,
        context("invalid-" + String(input)), "owner")).ok).toBe(false);
    }
  });

  it("enforces owner consent before any Git command can spawn", async () => {
    const { gateway, permissions, events } = setup(async () => "deny");
    const result = await gateway.execute("cli.git.diff", { root },
      context("git-denied"), "owner");
    expect(result).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(permissions.authorize).toHaveBeenCalledWith(expect.objectContaining({
      scope: "filesystem:read:selected", resource: root
    }));
    expect(events.map(event => event.status)).toEqual(["denied"]);
    expect(inspectLocalGit).not.toHaveBeenCalled();
  });

  it("journals started/completed receipts and binds a fixed Git operation", async () => {
    const { gateway, permissions, events } = setup();
    const result = await gateway.execute<string>("cli.git.diff-staged", { root },
      context("git-staged"), "owner");
    expect(result).toEqual(ok("M readme.txt"));
    expect(permissions.authorize).toHaveBeenCalledOnce();
    expect(inspectLocalGit).toHaveBeenCalledExactlyOnceWith(
      root, "/git diff staged", expect.anything()
    );
    expect(events.map(event => event.status)).toEqual(["started", "completed"]);
  });

  it("rechecks the live selected project after asynchronous owner permission", async () => {
    let release!: () => void;
    let entered!: () => void;
    const authorizationStarted = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const { gateway, select } = setup(async () => {
      entered();
      await hold;
      return "allow";
    });
    const run = gateway.execute("cli.git.status", { root }, context("git-root-changed"), "owner");
    await authorizationStarted;
    select("C:\\different-project");
    release();
    expect(await run).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(inspectLocalGit).not.toHaveBeenCalled();
  });

  it("refuses to inspect a removed project even with previously valid input", async () => {
    const { gateway, select } = setup();
    select("");
    expect((await gateway.execute("cli.git.log", { root },
      context("git-no-project"), "owner")).ok).toBe(false);
    expect(inspectLocalGit).not.toHaveBeenCalled();
  });
});
