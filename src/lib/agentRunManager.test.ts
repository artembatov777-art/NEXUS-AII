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

  it("records failures without rejecting the manager task", async () => {
    const manager = new AgentRunManager();
    await manager.start("broken", "chat", async () => { throw new Error("offline"); });
    expect(manager.list()[0]).toMatchObject({ status: "failed", error: "offline" });
  });
});
