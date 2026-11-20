import { describe, expect, it } from "vitest";
import { LocalStorageAgentActivityRepository } from "./agentActivityStorage";
import type { StorageLike } from "./memoryStorage";
import { agentActivityLabel } from "./agentActivity";

const makeStorage = (): StorageLike => {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } };
};

describe("durable agent activity journal", () => {
  it("survives a repository restart and isolates conversations", async () => {
    const storage = makeStorage();
    const first = new LocalStorageAgentActivityRepository(storage);
    expect((await first.append({ runId: "run-1", conversationId: "chat-a", kind: "started", timestamp: 10 })).ok).toBe(true);
    expect((await first.append({ runId: "run-1", conversationId: "chat-a", kind: "progress", step: 2, maxSteps: 4, timestamp: 11 })).ok).toBe(true);
    expect((await first.append({ runId: "run-2", conversationId: "chat-b", kind: "approval", timestamp: 12 })).ok).toBe(true);
    const second = new LocalStorageAgentActivityRepository(storage);
    expect(await second.listByConversation("chat-a", 10)).toMatchObject({
      ok: true, value: [
        { runId: "run-1", conversationId: "chat-a", kind: "started" },
        { runId: "run-1", conversationId: "chat-a", kind: "progress", step: 2, maxSteps: 4 }
      ]
    });
    const other = await second.listByConversation("chat-b", 10);
    expect(other.ok && other.value).toHaveLength(1);
  });

  it("keeps the newest entries in chronological order and enforces limits", async () => {
    const repo = new LocalStorageAgentActivityRepository(makeStorage());
    for (let i = 0; i < 12; i++) {
      expect((await repo.append({ runId: "run", conversationId: "chat", kind: "progress", timestamp: i })).ok).toBe(true);
    }
    const result = await repo.listByConversation("chat", 3);
    expect(result.ok && result.value.map(event => event.timestamp)).toEqual([9, 10, 11]);
    expect((await repo.listByConversation("chat", 0)).ok).toBe(false);
    expect((await repo.listByConversation("chat", 201)).ok).toBe(false);
  });

  it("never accepts arbitrary messages, provider text, or unrecognized event fields", async () => {
    const storage = makeStorage();
    const repo = new LocalStorageAgentActivityRepository(storage);
    const unsafe = { runId: "run", conversationId: "chat", kind: "output",
      message: "TOKEN_DO_NOT_PERSIST", timestamp: 10 };
    expect((await repo.append(unsafe as never)).ok).toBe(false);
    expect((await repo.append({ runId: "run", conversationId: "chat", kind: "progress",
      timestamp: 10, step: 0 })).ok).toBe(false);
    expect((await repo.append({ runId: "run", conversationId: "chat", kind: "progress",
      timestamp: 10, step: 1, maxSteps: 3 })).ok).toBe(true);
    expect(JSON.stringify(await repo.listByConversation("chat", 10))).not.toContain("TOKEN_DO_NOT_PERSIST");
    expect(agentActivityLabel({ runId: "run", conversationId: "chat", kind: "progress",
      timestamp: 10, step: 1, maxSteps: 3 })).toBe("Step 1 of 3");
  });

  it("rejects corrupt persisted data without silently replacing it", async () => {
    const storage: StorageLike = {
      getItem: () => "{invalid", setItem: () => { throw Error("must not write"); }
    };
    const repo = new LocalStorageAgentActivityRepository(storage);
    expect((await repo.listByConversation("chat", 10)).ok).toBe(false);
    expect((await repo.append({ runId: "run", conversationId: "chat", kind: "started", timestamp: 1 })).ok).toBe(false);
  });
});
