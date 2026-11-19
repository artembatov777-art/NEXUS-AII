// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { AgentRunManager } from "../lib/agentRunManager";
import { AgentTerminalOutput } from "./AgentTerminalOutput";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("AgentTerminalOutput", () => {
  it("shows live events only in the owning conversation and can cancel its run", async () => {
    const manager = new AgentRunManager();
    const element = document.createElement("div"); document.body.appendChild(element);
    const root = createRoot(element);
    const onOpen = vi.fn();
    const render = (conversationId: string) => <AgentTerminalOutput agentRuns={manager} conversationId={conversationId} onOpen={onOpen}/>;
    await act(async () => { root.render(render("one")); });
    let started!: Promise<void>;
    await act(async () => {
      started = manager.start("run", "one", signal => new Promise<void>(resolve =>
        signal.addEventListener("abort", () => resolve(), { once: true })
      ));
      manager.appendEvent("run", "progress", "inspecting approved files");
    });
    expect(element.textContent).toContain("inspecting approved files");
    expect(element.textContent).toContain("Running");
    await act(async () => { root.render(render("two")); });
    expect(element.querySelector(".agent-terminal-output")).toBeNull();
    await act(async () => { root.render(render("one")); });
    await act(async () => { element.querySelector<HTMLButtonElement>('button[aria-label="Cancel this agent run"]')!.click(); await started; });
    expect(manager.list("one")[0].status).toBe("cancelled");
    await act(async () => { element.querySelectorAll<HTMLButtonElement>("button")[0].click(); });
    expect(onOpen).toHaveBeenCalledOnce();
    await act(async () => root.unmount()); element.remove();
  });
});
