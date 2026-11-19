// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { KeepAlivePanel } from "./KeepAlivePanel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
describe("KeepAlivePanel", () => {
  it("preserves child effects and state while hidden and shown", () => {
    const element = document.createElement("div"); document.body.appendChild(element);
    const root = createRoot(element);
    const mounted = vi.fn(), unmounted = vi.fn();
    function Child() { useEffect(() => { mounted(); return () => unmounted(); }, []); return <button>Agent controls</button>; }
    act(() => root.render(<KeepAlivePanel open><Child /></KeepAlivePanel>));
    act(() => root.render(<KeepAlivePanel open={false}><Child /></KeepAlivePanel>));
    expect(element.firstElementChild?.hasAttribute("hidden")).toBe(true);
    expect(element.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(unmounted).not.toHaveBeenCalled();
    act(() => root.render(<KeepAlivePanel open><Child /></KeepAlivePanel>));
    expect(mounted).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(unmounted).toHaveBeenCalledTimes(1);
    element.remove();
  });
});
