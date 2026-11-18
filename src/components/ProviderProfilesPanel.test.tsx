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
const onDeleteCredential = vi.fn(async (_handle: string) => {});
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
  it("routes browser-compatible provider presets through Railway without connecting or storing a key", async () => {
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={localSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    const presetButton = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Use Groq (free tier) on Railway");
    expect(presetButton).toBeTruthy();
    await act(async () => { presetButton!.click(); });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "/api/provider/groq",
      model: "",
      inferenceLocation: "remote",
      credentialHandle: "default",
      providerProtocol: "openai-chat-completions"
    }));
    expect(container.textContent).toContain("Hosted providers: Gemini, Groq and NVIDIA.");
    expect(container.textContent).toContain("without an expiry date");
    expect(window.localStorage.getItem("nexus-au:provider-profiles:v1")).toBeNull();
  });

  it("loads saved profiles without starting a provider connection", async () => {
    expect(saveProviderProfiles([{
      id: "nexus.cloud", label: "Cloud", settings: cloudSettings
    }]).ok).toBe(true);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={localSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    const option = container.querySelector<HTMLOptionElement>('option[value="nexus.cloud"]');
    expect(option?.textContent).toBe("Cloud");
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Selecting a profile does not connect to it.");
  });

  it("saves a named profile without persisting credentials", async () => {
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={localSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    setValue(container.querySelector<HTMLInputElement>('[aria-label="New provider profile name"]')!, "Local model");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Save as profile")!.click(); });
    const raw = window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? "";
    expect(raw).toContain("Local model");
    expect(raw).not.toContain("apiKey");
    expect(raw).toContain("127.0.0.1:11434");
  });

  it("assigns an isolated OS-vault handle to each new cloud profile", async () => {
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={cloudSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    setValue(container.querySelector<HTMLInputElement>('[aria-label="New provider profile name"]')!, "Second cloud");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Save as profile")!.click(); });
    const saved = JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}');
    const handle = saved.profiles[0]?.settings?.credentialHandle;
    expect(handle).toMatch(/^profile-[a-f0-9]{32}$/);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ credentialHandle: handle }));
    expect(container.textContent).toContain("Enter and save its API key");
  });

  it("imports existing local profiles into the authenticated cloud store", async () => {
    saveProviderProfiles([{ id: "nexus.cloud", label: "Cloud", settings: cloudSettings, updatedAt: 123 }]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schemaVersion: 1, profiles: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<ProviderProfilesPanel
        currentSettings={localSettings}
        gatewaySessionReady
        onSelect={onSelect}
        onDeleteCredential={onDeleteCredential}
      />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/profiles");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT", credentials: "same-origin" });
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain("nexus.cloud");
    expect(container.querySelector('option[value="nexus.cloud"]')).toBeTruthy();
  });

  it("retries cloud profile synchronization after the Railway volume becomes available", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Railway persistent Volume is not mounted." })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ schemaVersion: 1, profiles: [], deletedProfileIds: [] })
      });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<ProviderProfilesPanel
        currentSettings={localSettings}
        gatewaySessionReady
        onSelect={onSelect}
        onDeleteCredential={onDeleteCredential}
      />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("cloud synchronization failed");
    const retry = Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Sync profiles now");
    expect(retry).toBeTruthy();
    await act(async () => {
      retry!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("synchronized with your NEXUS account and this device");
  });

  it("restores cloud profiles into a fresh Home Screen app storage", async () => {
    const cloudProfile = { id: "nexus.cloud", label: "Cloud", settings: cloudSettings, updatedAt: 456 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaVersion: 1, profiles: [cloudProfile], deletedProfileIds: [] })
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(<ProviderProfilesPanel
        currentSettings={localSettings}
        gatewaySessionReady
        onSelect={onSelect}
        onDeleteCredential={onDeleteCredential}
      />);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('option[value="nexus.cloud"]')).toBeTruthy();
    expect(window.localStorage.getItem("nexus-au:provider-profiles:v1")).toContain("Cloud");
  });

  it("deletes a dedicated vault key together with its profile", async () => {
    const handle = "profile-0123456789abcdef0123456789abcdef";
    const settings = { ...cloudSettings, credentialHandle: handle };
    saveProviderProfiles([{ id: "nexus.cloud", label: "Cloud", settings }]);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={settings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Delete profile")!.click(); });
    expect(onDeleteCredential).toHaveBeenCalledWith(handle);
    expect(JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}').profiles).toHaveLength(0);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ credentialHandle: "none" }));
  });

  it("restores a dedicated profile if its key cannot be deleted", async () => {
    const handle = "profile-0123456789abcdef0123456789abcdef";
    const settings = { ...cloudSettings, credentialHandle: handle };
    saveProviderProfiles([{ id: "nexus.cloud", label: "Cloud", settings }]);
    onDeleteCredential.mockRejectedValueOnce(new Error("vault unavailable"));
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={settings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Delete profile")!.click(); });
    expect(JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}').profiles).toHaveLength(1);
    expect(container.textContent).toContain("profile was restored");
  });

  it("does not switch profiles when the current profile has unsaved changes and the owner cancels", async () => {
    saveProviderProfiles([
      { id: "nexus.cloud", label: "Cloud", settings: cloudSettings },
      { id: "nexus.local", label: "Local", settings: localSettings }
    ]);
    const changedSettings = { ...cloudSettings, model: "unsaved-model-change" };
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={changedSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    vi.stubGlobal("confirm", vi.fn(() => false));
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Saved provider profiles"]')!;
    await act(async () => {
      select.value = "nexus.local";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}').profiles)
      .toHaveLength(2);
  });

  it("keeps a saved profile when deletion is cancelled", async () => {
    saveProviderProfiles([{ id: "nexus.cloud", label: "Cloud", settings: cloudSettings }]);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={cloudSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    vi.stubGlobal("confirm", vi.fn(() => false));
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Delete profile")!.click(); });
    expect(JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}').profiles)
      .toHaveLength(1);
  });

  it("updates and deletes the selected profile", async () => {
    saveProviderProfiles([{ id: "nexus.cloud", label: "Cloud", settings: cloudSettings }]);
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={cloudSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    const updatedSettings = { ...cloudSettings, model: "model-b" };
    await act(async () => { root.render(<ProviderProfilesPanel currentSettings={updatedSettings} onSelect={onSelect} onDeleteCredential={onDeleteCredential}/>); });
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Update selected")!.click(); });
    expect(window.localStorage.getItem("nexus-au:provider-profiles:v1")).toContain("model-b");
    await act(async () => { Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Delete profile")!.click(); });
    expect(JSON.parse(window.localStorage.getItem("nexus-au:provider-profiles:v1") ?? '{"profiles":[]}').profiles).toEqual([]);
    expect(onDeleteCredential).not.toHaveBeenCalled();
  });
});
