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
    expect(() => manager.start("bad\\nrun", "chat", async () => {})).toThrow("Invalid");
    expect(() => manager.start("good", " ", async () => {})).toThrow("Invalid");
  });
  it("records failures without rejecting the manager task", async () => {
    const manager = new AgentRunManager();
    await manager.start("broken", "chat", async () => { throw new Error("offline"); });
    expect(manager.list()[0]).toMatchObject({ status: "failed", error: "offline" });
  });
});
