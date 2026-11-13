import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "./storage";
import {
  loadProviderProfiles, removeProviderProfile, saveProviderProfiles,
  upsertProviderProfile, validateProviderProfile
} from "./providerProfiles";
import type { ProviderProfileRecord } from "./providerProfiles";

class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const ollama: ProviderProfileRecord = {
  id: "nexus.ollama",
  label: "Ollama local",
  settings: {
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "",
    inferenceLocation: "local",
    credentialHandle: "none"
  }
};

describe("provider profile persistence", () => {
  it("saves and reloads multiple profiles without storing credentials", () => {
    const storage = new MemoryStorage();
    const cloud: ProviderProfileRecord = {
      id: "nexus.cloud",
      label: "Cloud gateway",
      settings: { baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote", credentialHandle: "default" }
    };
    expect(saveProviderProfiles([ollama, cloud], storage)).toMatchObject({ ok: true });
    const raw = storage.values.get("nexus-au:provider-profiles:v1") ?? "";
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("secret");
    expect(loadProviderProfiles(storage)).toEqual({ ok: true, value: [ollama, cloud] });
  });

  it("rejects non-loopback no-key profiles and insecure remote HTTP endpoints", () => {
    expect(validateProviderProfile({
      ...ollama, settings: { ...ollama.settings, baseUrl: "https://api.example/v1" }
    })).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(validateProviderProfile({
      ...ollama, settings: { ...ollama.settings, baseUrl: "http://gateway.example/v1", credentialHandle: "default" }
    })).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("drops unrecognized secret fields while normalizing a profile", () => {
    const result = validateProviderProfile({
      ...ollama, apiKey: "do-not-persist",
      settings: { ...ollama.settings, apiKey: "also-do-not-persist" }
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("do-not-persist");
  });

  it("rejects duplicate IDs and profile collections over the configured limit", () => {
    const storage = new MemoryStorage();
    expect(saveProviderProfiles([ollama, ollama], storage)).toMatchObject({ ok: false });
    const many = Array.from({ length: 17 }, (_, index) => ({
      ...ollama, id: `nexus.profile.${index}`
    }));
    expect(saveProviderProfiles(many, storage)).toMatchObject({ ok: false });
  });

  it("leaves malformed persisted data untouched instead of silently replacing it", () => {
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:provider-profiles:v1", "{broken");
    expect(loadProviderProfiles(storage)).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(storage.getItem("nexus-au:provider-profiles:v1")).toBe("{broken");
  });

  it("supports validated profile upsert and removal", () => {
    const added = upsertProviderProfile([], ollama);
    expect(added).toEqual({ ok: true, value: [ollama] });
    if (!added.ok) throw new Error("Profile should have been added.");
    const updated = upsertProviderProfile(added.value, { ...ollama, label: "Local Ollama" });
    expect(updated).toMatchObject({ ok: true, value: [{ label: "Local Ollama" }] });
    expect(removeProviderProfile(updated.ok ? updated.value : [], "nexus.ollama"))
      .toEqual({ ok: true, value: [] });
  });
});
