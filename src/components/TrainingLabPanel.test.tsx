// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isTauriMock } = vi.hoisted(() => ({ isTauriMock: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: isTauriMock, invoke: vi.fn() }));
import { TrainingLabPanel } from "./TrainingLabPanel";

let container: HTMLDivElement;
let root: Root;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  window.localStorage.clear();
  isTauriMock.mockReturnValue(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("Training Lab privacy and preview mode", () => {
  it("rejects duplicate split IDs instead of silently deduplicating user input", async () => {
    await act(async () => { root.render(<TrainingLabPanel onClose={vi.fn()} provider={{ baseUrl: "http://127.0.0.1:20128/v1", model: "auto", inferenceLocation: "remote", credentialHandle: "default" }} availableModels={[]} />); });
    const trainIds = Array.from(container.querySelectorAll("textarea")).find(textarea =>
      textarea.parentElement?.textContent?.includes("Train sample IDs")
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(trainIds, "duplicate\nduplicate");
      trainIds.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Save dataset version"))!;
    await act(async () => { save.click(); });
    expect(container.textContent).toContain("Dataset metadata is invalid");
    expect(container.textContent).toContain("disjoint split IDs");
  });

  it("discloses that live evaluation prompts are sent to the configured provider", async () => {
    await act(async () => { root.render(<TrainingLabPanel onClose={vi.fn()} provider={{ baseUrl: "http://127.0.0.1:20128/v1", model: "auto", inferenceLocation: "remote", credentialHandle: "default" }} availableModels={[]} />); });
    expect(container.textContent).toContain("running a test, comparison, or dataset evaluation sends evaluation inputs to the configured provider");
    const liveTest = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Run live model test"));
    const compare = Array.from(container.querySelectorAll("button")).find(button => button.textContent?.includes("Compare selected models"));
    expect(liveTest?.disabled).toBe(true);
    expect(compare?.disabled).toBe(true);
  });
});
