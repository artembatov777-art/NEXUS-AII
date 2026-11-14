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

function setValue(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

describe("ProviderProfilesPanel", () => {
  it("loads saved profiles without starting a provider connection", async () => {
    expect(saveProviderProfiles([{
      id: "nexus.cloud", label: "Cloud", settings: cloudSettings
    }]).ok).toBe(true);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={localSettings} onSelect={onSelect}/>); });
    const option = container.querySelector<HTMLOptionElement>('option[value="nexus.cloud"]');
    expect(option?.textContent).toBe("Cloud");
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Selecting a profile does not connect to it.");
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

  it("keeps a saved profile when deletion is cancelled", async () => {
    saveProviderProfiles([{ id: "nexus.cloud", label: "Cloud", settings: cloudSettings }]);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={cloudSettings} onSelect={onSelect}/>); });
    vi.stubGlobal("confirm", vi.fn(() => false));
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Delete profile")!.click(); });
    expect(JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}').profiles)
      .toHaveLength(1);
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
