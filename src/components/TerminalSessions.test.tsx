// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TerminalSessions } from "./TerminalSessions";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("terminal session tabs", () => {
  it("switches, closes without deleting history, and creates sessions", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    const select = vi.fn(), close = vi.fn(), create = vi.fn();
    act(() => root.render(<TerminalSessions sessions={[{ id: "one", title: "First" }, { id: "two", title: "Second" }]} activeId="one" onSelect={select} onClose={close} onCreate={create} />));
    const second = element.querySelector<HTMLButtonElement>('button[aria-label="Open session Second"]')!;
    act(() => second.click());
    expect(select).toHaveBeenCalledWith("two");
    act(() => element.querySelector<HTMLButtonElement>('button[aria-label="Close session First"]')!.click());
    expect(close).toHaveBeenCalledWith("one");
    expect(select).toHaveBeenCalledTimes(1);
    act(() => element.querySelector<HTMLButtonElement>('button[aria-label="New session"]')!.click());
    expect(create).toHaveBeenCalledOnce();
    expect(element.querySelector('[aria-current="page"]')?.textContent).toContain("First");
    act(() => root.unmount());
    element.remove();
  });
});
