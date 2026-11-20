import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { NativeAgentActivityRepository } from "./nativeAgentActivityRepository";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockedInvoke = vi.mocked(invoke);

describe("native SQLite agent activity repository", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("persists a strictly validated event via the native journal command", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    const event = { runId: "run-a", conversationId: "chat-one",
      kind: "progress" as const, timestamp: 20, step: 1, maxSteps: 3 };
    expect(await new NativeAgentActivityRepository().append(event)).toEqual({ ok: true, value: undefined });
    expect(mockedInvoke).toHaveBeenCalledWith("record_agent_activity_event", { event });
  });

  it("lists saved events for only one conversation in bounded order", async () => {
    const events = [{ runId: "run-a", conversationId: "chat-one",
      kind: "started", timestamp: 11 }];
    mockedInvoke.mockResolvedValueOnce(events);
    expect(await new NativeAgentActivityRepository().listByConversation("chat-one", 80))
      .toMatchObject({ ok: true, value: events });
    expect(mockedInvoke).toHaveBeenCalledWith("list_agent_activity_events", {
      conversationId: "chat-one", limit: 80
    });
  });

  it("rejects unsafe arbitrary text before issuing a native command", async () => {
    const repo = new NativeAgentActivityRepository();
    expect((await repo.append({ runId: "run", conversationId: "chat", kind: "output",
      message: "PRIVATE", timestamp: 5 } as never)).ok).toBe(false);
    expect((await repo.listByConversation("chat", 9999)).ok).toBe(false);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("fails closed on errors or corrupted native rows", async () => {
    const repo = new NativeAgentActivityRepository();
    mockedInvoke.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await repo.listByConversation("chat", 10))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
    mockedInvoke.mockResolvedValueOnce([{ conversationId: "other", runId: "run",
      kind: "started", timestamp: 1 }]);
    expect(await repo.listByConversation("chat", 10))
      .toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });
});
