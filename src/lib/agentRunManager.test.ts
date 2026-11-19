import { describe, expect, it, vi } from "vitest";
import { AgentRunManager } from "./agentRunManager";

describe("AgentRunManager", () => {
  it("keeps a run alive when its UI listener unsubscribes", async () => {
    const manager = new AgentRunManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const run = manager.start("run-1", "chat-1", async () => { await waiting; });
    unsubscribe();
    expect(manager.list("chat-1")[0].status).toBe("running");
    finish();
    await run;
    expect(manager.list("chat-1")[0].status).toBe("completed");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("isolates runs by conversation and rejects duplicate IDs", async () => {
    const manager = new AgentRunManager();
    await manager.start("a", "chat-a", async () => {});
    await manager.start("b", "chat-b", async () => {});
    expect(manager.list("chat-a").map(run => run.id)).toEqual(["a"]);
    expect(() => manager.start("a", "chat-b", async () => {})).toThrow("already exists");
  });

  it("propagates cancellation through AbortSignal", async () => {
    const manager = new AgentRunManager();
    const run = manager.start("cancel-me", "chat", signal => new Promise<void>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    expect(manager.cancel("cancel-me")).toBe(true);
    expect(manager.cancel("cancel-me")).toBe(false);
    await run;
    expect(manager.list()[0].status).toBe("cancelled");
    expect(manager.cancel("cancel-me")).toBe(false);
  });

  it("allows independent conversations but prevents overlapping runs in one conversation", async () => {
    const manager = new AgentRunManager();
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const first = manager.start("first", "same", async () => { await waiting; });
    expect(() => manager.start("second", "same", async () => {})).toThrow("active run");
    await manager.start("third", "other", async () => {});
    finish();
    await first;
    await manager.start("fourth", "same", async () => {});
    expect(manager.list("same").map(run => run.status)).toEqual(["completed", "completed"]);
  });

  it("keeps bounded per-run event history isolated from other conversations", async () => {
    const manager = new AgentRunManager();
    await manager.start("a", "one", async () => {});
    await manager.start("b", "two", async () => {});
    for (let index = 0; index < 205; index++) manager.appendEvent("a", "progress", String(index));
    manager.appendEvent("b", "output", "secret");
    expect(manager.history("a")).toHaveLength(200);
    expect(manager.history("a")[0].message).toBe("5");
    expect(manager.history("a").some(event => event.message === "secret")).toBe(false);
    const events = manager.history("b");
    events[0].message = "modified";
    expect(manager.history("b")[0].message).toBe("secret");
    expect(() => manager.appendEvent("missing", "error", "no")).toThrow("Unknown run");
  });

  it("records start and finish timestamps", async () => {
    const manager = new AgentRunManager();
    await manager.start("timestamp", "chat", async () => {});
    const run = manager.list()[0];
    expect(run.finishedAt).toBeGreaterThanOrEqual(run.startedAt);
  });

  it("rejects malformed run and conversation IDs", () => {
    const manager = new AgentRunManager();
    expect(() => manager.start("bad\nrun", "chat", async () => {})).toThrow("Invalid");
    expect(() => manager.start("good", " ", async () => {})).toThrow("Invalid");
  });
  it("exposes only the active run for its conversation", async () => {
    const manager = new AgentRunManager();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const task = manager.start("active", "chat", async () => { await pending; });
    expect(manager.activeRun("chat")?.id).toBe("active");
    expect(manager.activeRun("other")).toBeNull();
    finish();
    await task;
    expect(manager.activeRun("chat")).toBeNull();
  });
  it("cancels only the selected conversation", async () => {
    const manager = new AgentRunManager();
    const pending = (signal: AbortSignal) => new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    const first = manager.start("one", "chat-a", pending);
    const second = manager.start("two", "chat-b", pending);
    expect(manager.cancelConversation("chat-a")).toBe(true);
    await first;
    expect(manager.activeRun("chat-b")?.id).toBe("two");
    expect(manager.cancelConversation("chat-b")).toBe(true);
    await second;
  });
  it("summarizes runs for the selected conversation", async () => {
    const manager = new AgentRunManager();
    await manager.start("a", "chat-a", async () => {});
    await manager.start("b", "chat-b", async () => { throw new Error("failed"); });
    expect(manager.summary("chat-a").completed).toBe(1);
    expect(manager.summary("chat-a").failed).toBe(0);
    expect(manager.summary().failed).toBe(1);
  });
  it("exposes truncated terminal event previews", async () => {
    const manager = new AgentRunManager();
    await manager.start("run", "chat", async () => {});
    manager.appendEvent("run", "output", "123456");
    expect(manager.eventPreview("run", 3)).toEqual(["123…"]);
    expect(manager.history("run")[0].message).toBe("123456");
  });
  it("provides isolated conversation event timelines", async () => {
    const manager = new AgentRunManager();
    await manager.start("a", "chat-a", async () => {});
    await manager.start("b", "chat-b", async () => {});
    manager.appendEvent("a", "progress", "first");
    manager.appendEvent("b", "progress", "private");
    expect(manager.conversationTimeline("chat-a").map(e => e.message)).toEqual(["first"]);
  });
  it("filters error events without exposing unrelated conversations", async () => {
    const manager = new AgentRunManager();
    await manager.start("a", "chat-a", async () => {});
    await manager.start("b", "chat-b", async () => {});
    manager.appendEvent("a", "error", "a-error");
    manager.appendEvent("a", "progress", "a-progress");
    manager.appendEvent("b", "error", "b-error");
    expect(manager.eventsByKind("chat-a", ["error"]).map(e => e.message)).toEqual(["a-error"]);
  });
  it("preserves approval-waiting outcomes for resumable workflows", async () => {
    const manager = new AgentRunManager();
    await manager.start("approval", "chat", async () => "waiting_for_approval");
    expect(manager.list()[0].status).toBe("waiting_for_approval");
    expect(manager.activeRun("chat")).toBeNull();
    await manager.start("next", "chat", async () => "failed");
    expect(manager.summary("chat").failed).toBe(1);
    expect(manager.summary("chat").waiting_for_approval).toBe(1);
  });

  it("reconciles approval-waiting manager records with resumed runtime checkpoints", async () => {
    const manager = new AgentRunManager();
    await manager.start("first", "chat", async () => "waiting_for_approval");
    manager.linkRuntimeRun("first", "checkpoint");
    expect(manager.list("chat")[0].runtimeRunId).toBe("checkpoint");
    expect(manager.resolveWaiting("checkpoint", "completed")).toBe(true);
    expect(manager.list("chat")[0].status).toBe("completed");
    expect(manager.resolveWaiting("checkpoint", "failed")).toBe(false);
  });

  it("blocks linking a runtime checkpoint across conversations", async () => {
    const manager = new AgentRunManager();
    await manager.start("first", "one", async () => {});
    await manager.start("second", "two", async () => {});
    manager.linkRuntimeRun("first", "checkpoint");
    expect(() => manager.linkRuntimeRun("second", "checkpoint")).toThrow("another conversation");
    expect(() => manager.linkRuntimeRun("second", "wrong\nid")).toThrow("Invalid");
  });

  it("continues execution if a UI subscriber throws", async () => {
    const manager = new AgentRunManager();
    const unsubscribe = manager.subscribe(() => { throw new Error("broken panel"); });
    await manager.start("safe-run", "chat", async () => {});
    expect(manager.list()[0].status).toBe("completed");
    unsubscribe();
  });

  it("bounds retained terminal runs without deleting active approval requests", async () => {
    const manager = new AgentRunManager();
    await manager.start("approval", "chat", async () => "waiting_for_approval");
    for (let index = 0; index < 260; index++) {
      await manager.start("run-" + index, "chat", async () => {});
      manager.appendEvent("run-" + index, "output", "completed");
    }
    expect(manager.list().length).toBe(251);
    expect(manager.list().some(run => run.id === "approval")).toBe(true);
    expect(manager.list().some(run => run.id === "run-0")).toBe(false);
    expect(manager.history("run-0")).toEqual([]);
    expect(manager.list().filter(run => run.status === "completed")).toHaveLength(250);
  });

  it("does not broadcast unchanged run status for every progress event", async () => {
    const manager = new AgentRunManager();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    await manager.start("run", "chat", async () => {});
    const notified = listener.mock.calls.length;
    manager.appendEvent("run", "progress", "step one");
    manager.appendEvent("run", "output", "result");
    expect(listener).toHaveBeenCalledTimes(notified);
    expect(manager.history("run")).toHaveLength(2);
    unsubscribe();
  });

  it("broadcasts isolated progress events without broadcasting an unchanged run status", async () => {
    const manager = new AgentRunManager();
    const listener = vi.fn(), broken = vi.fn(() => { throw new Error("broken terminal"); });
    await manager.start("run", "chat", async () => {});
    const unsubscribe = manager.subscribeEvents(listener);
    const unsubscribeBroken = manager.subscribeEvents(broken);
    manager.appendEvent("run", "progress", "step");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toMatchObject({ runId: "run", conversationId: "chat", kind: "progress", message: "step" });
    expect(manager.history("run")).toHaveLength(1);
    unsubscribe();
    unsubscribeBroken();
    manager.appendEvent("run", "output", "done");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("bounds retained event content to prevent unbounded tool-output memory use", async () => {
    const manager = new AgentRunManager();
    await manager.start("large", "chat", async () => {});
    manager.appendEvent("large", "output", "x".repeat(50_000));
    const saved = manager.history("large")[0].message;
    expect(saved.length).toBeLessThan(16_050);
    expect(saved).toContain("[Event output truncated]");
  });

  it("records failures without rejecting the manager task", async () => {
    const manager = new AgentRunManager();
    await manager.start("broken", "chat", async () => { throw new Error("offline"); });
    expect(manager.list()[0]).toMatchObject({ status: "failed", error: "offline" });
  });
});
