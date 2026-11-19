import { describe, expect, it, vi } from "vitest";
import { AgentCheckpointService, type AgentCheckpoint } from "./agentCheckpoints";
import { ResumableAgentRuntime, type ResumableAgentDefinition } from "./resumableAgents";
import { LocalStorageAgentCheckpointRepository } from "../lib/agentCheckpointStorage";
import type { StorageLike } from "../lib/memoryStorage";
import { ok, err } from "./result";
import type { AgentId, AgentRunId } from "./agents";

const runId = "interrupted-run" as AgentRunId;
const agentId = "safe-recovery" as AgentId;
const initial: AgentCheckpoint = {
  schemaVersion: 1, runId, agentId, threadId: "thread",
  sequence: 1, status: "running",
  state: { payload: { count: 0 }, permissionIndex: 1, agentVersion: "1", steps: 0 },
  createdAt: 100, updatedAt: 100
};
const make = async (permission: "allow" | "deny" | "ask_user", auditAllowed: boolean) => {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
  const service = new AgentCheckpointService(new LocalStorageAgentCheckpointRepository(storage));
  await service.persist(initial);
  const authorize = vi.fn(async () => permission);
  const step = vi.fn(async () => ({ state: { count: 1 }, done: true }));
  const runtime = new ResumableAgentRuntime(
    service, { authorize }, { runId: () => runId }, { now: () => 200 },
    undefined, undefined,
    { verifySafeContinuation: vi.fn(async () => auditAllowed ? ok(undefined) : err("permission_denied", "Unsafe replay.")) }
  );
  const definition: ResumableAgentDefinition = {
    id: agentId, version: "1", name: "Recovery", requiredPermissions: ["tool:execute"],
    maxSteps: 3, timeoutMs: 1000, createState: () => ({ count: 0 }), step
  };
  runtime.register(definition);
  return { runtime, authorize, step, service };
};
const collect = async (events: AsyncIterable<unknown>) => { const out: unknown[] = []; for await (const event of events) out.push(event); return out; };

describe("manual agent continuation", () => {
  it("rechecks permissions even if the checkpoint says previously approved", async () => {
    const { runtime, authorize, step, service } = await make("deny", true);
    const events = await collect(runtime.continue(runId));
    expect(events).toMatchObject([{ type: "failed" }]);
    expect(authorize).toHaveBeenCalledOnce();
    expect(step).not.toHaveBeenCalled();
    const saved = await service.get(runId);
    expect(saved.ok && saved.value?.sequence).toBe(1);
  });
  it("refuses to execute when audit verification fails", async () => {
    const { runtime, authorize, step } = await make("allow", false);
    const events = await collect(runtime.continue(runId));
    expect(events).toMatchObject([{ type: "failed" }]);
    expect(authorize).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
  });
  it("requeues a new approval instead of silently reusing a prior one", async () => {
    const { runtime, step, service } = await make("ask_user", true);
    const events = await collect(runtime.continue(runId));
    expect(events).toMatchObject([{ type: "waiting_for_approval", permission: "tool:execute" }]);
    expect(step).not.toHaveBeenCalled();
    const saved = await service.get(runId);
    expect(saved.ok && saved.value?.status).toBe("waiting_for_approval");
  });
  it("continues only after fresh authorization and a verified audit", async () => {
    const { runtime, step, service } = await make("allow", true);
    const events = await collect(runtime.continue(runId));
    expect(events.at(-1)).toMatchObject({ type: "completed" });
    expect(step).toHaveBeenCalledOnce();
    const saved = await service.get(runId);
    expect(saved.ok && saved.value?.status).toBe("completed");
  });
});
