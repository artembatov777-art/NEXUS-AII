// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSettings } from "../types";
import { saveProviderProfiles } from "../lib/providerProfiles";
import { ProviderProfilesPanel } from "./ProviderProfilesPanel";

let container: HTMLDivElement;
let root: Root;
const onSelect = vi.fn();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const localSettings: ProviderSettings = {
  baseUrl: "http://127.0.0.1:11434/v1", model: "", inferenceLocation: "local", credentialHandle: "none"
};
const cloudSettings: ProviderSettings = {
  baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote", credentialHandle: "default"
};

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  act(() => { setter?.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); });

describe("ProviderProfilesPanel", () => {
  it("loads a saved profile and switches configuration without connecting", async () => {
    expect(saveProviderProfiles([{
      id: "nexus.cloud", label: "Cloud", settings: cloudSettings
    }]).ok).toBe(true);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={localSettings} onSelect={onSelect}/>); });
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Saved provider profiles"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, "nexus.cloud");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe("nexus.cloud");
    expect(onSelect).toHaveBeenCalledWith(cloudSettings);
    expect(container.textContent).toContain("No provider connection was started");
  });

  it("saves a named profile without persisting credentials", async () => {
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={localSettings} onSelect={onSelect}/>); });
    setValue(container.querySelector<HTMLInputElement>('[aria-label="New provider profile name"]')!, "Local model");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Save as profile")!.click(); });
    const raw = window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? "";
    expect(raw).toContain("Local model");
    expect(raw).not.toContain("apiKey");
    expect(raw).toContain("127.0.0.1:11434");
  });

  it("updates and deletes the selected profile", async () => {
    saveProviderProfiles([{ id: "nexus.cloud", label: "Cloud", settings: cloudSettings }]);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={cloudSettings} onSelect={onSelect}/>); });
    const updatedSettings = { ...cloudSettings, model: "model-b" };
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={updatedSettings} onSelect={onSelect}/>); });
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Update selected")!.click(); });
    expect(window.localStorage.getItem("nexus-au:provider-profiles:v1")).toContain("model-b");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Delete profile")!.click(); });
    expect(JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}').profiles).toEqual([]);
  });
});
