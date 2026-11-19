// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useSessionDraft } from "./useSessionDraft";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
function Editor({ id }: { id: string | null }) {
  const [draft, setDraft] = useSessionDraft(id);
  return <><span>{draft}</span><button onClick={() => setDraft(value => value + "x")}>Add</button></>;
}
describe("session drafts", () => {
  it("keeps unfinished input isolated when changing sessions", () => {
    const element = document.createElement("div"); document.body.appendChild(element);
    const root = createRoot(element);
    act(() => root.render(<Editor id="one"/>));
    act(() => element.querySelector("button")!.click());
    act(() => root.render(<Editor id="two"/>));
    expect(element.querySelector("span")!.textContent).toBe("");
    act(() => element.querySelector("button")!.click());
    act(() => element.querySelector("button")!.click());
    act(() => root.render(<Editor id="one"/>));
    expect(element.querySelector("span")!.textContent).toBe("x");
    act(() => root.unmount()); element.remove();
  });
});
