import { describe, expect, it, vi } from "vitest";
import type { StorageAdapter } from "./storage";
import {
  loadDeletedProviderProfileIds, loadProviderProfiles, removeProviderProfile, requestPersistentProviderProfileStorage, saveDeletedProviderProfileIds, saveProviderProfiles,
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

  it("stores validated profile deletion tombstones for later cloud synchronization", () => {
    const storage = new MemoryStorage();
    expect(saveDeletedProviderProfileIds(["nexus.deleted"], storage)).toMatchObject({ ok: true });
    expect(loadDeletedProviderProfileIds(storage)).toEqual(["nexus.deleted"]);
    expect(saveDeletedProviderProfileIds(["../invalid"], storage)).toMatchObject({ ok: false });
  });

  it("accepts only the trusted same-origin hosted gateway routes, including Groq", () => {
    for (const provider of ["gemini", "groq", "nvidia"]) {
      expect(validateProviderProfile({
        id: `nexus.${provider}`,
        label: provider,
        settings: {
          baseUrl: `/api/provider/${provider}`,
          model: "model-a",
          inferenceLocation: "remote",
          credentialHandle: "default",
          providerProtocol: "openai-chat-completions"
        }
      })).toMatchObject({ ok: true });
    }

    expect(validateProviderProfile({
      id: "nexus.untrusted",
      label: "Untrusted",
      settings: {
        baseUrl: "/api/other/route",
        model: "model-a",
        inferenceLocation: "remote",
        credentialHandle: "default"
      }
    })).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("requests persistent browser storage when the Storage API supports it", async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => false);
    vi.stubGlobal("navigator", { storage: { persist, persisted } });
    await expect(requestPersistentProviderProfileStorage()).resolves.toBe(true);
    expect(persisted).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("rejects non-loopback no-key profiles and insecure remote HTTP endpoints", () => {
    expect(validateProviderProfile({
      ...ollama, settings: { ...ollama.settings, baseUrl: "https://api.example/v1" }
    })).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(validateProviderProfile({
      ...ollama, settings: { ...ollama.settings, baseUrl: "http://gateway.example/v1", credentialHandle: "default" }
    })).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("accepts a strictly formatted dedicated OS-vault handle and rejects arbitrary handles", () => {
    const handle = "profile-0123456789abcdef0123456789abcdef";
    expect(validateProviderProfile({
      ...ollama,
      settings: { ...ollama.settings, baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote", credentialHandle: handle }
    })).toMatchObject({ ok: true, value: { settings: { credentialHandle: handle } } });
    expect(validateProviderProfile({
      ...ollama,
      settings: { ...ollama.settings, baseUrl: "https://api.example/v1", model: "model-a", inferenceLocation: "remote", credentialHandle: "profile-../../secret" }
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


  it("preserves the Claude protocol and manual routing mode without storing secrets", () => {
    const result = validateProviderProfile({
      ...ollama,
      settings: {
        ...ollama.settings,
        baseUrl: "https://api.anthropic.com/v1",
        model: "claude-sonnet",
        inferenceLocation: "remote",
        credentialHandle: "default",
        providerProtocol: "anthropic-messages",
        routeMode: "manual"
      }
    });
    expect(result).toMatchObject({
      ok: true,
      value: { settings: { providerProtocol: "anthropic-messages", routeMode: "manual" } }
    });
  });

  it("enforces the native provider's UTF-8 model ID byte limit", () => {
    expect(validateProviderProfile({
      ...ollama, settings: { ...ollama.settings, model: "я".repeat(65) }
    })).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("rejects duplicate IDs and profile collections over the configured limit", () => {
    const storage = new MemoryStorage();
    expect(saveProviderProfiles([ollama, ollama], storage)).toMatchObject({ ok: false });
    const many = Array.from({ length: 17 }, (_, index) => ({
      ...ollama, id: `nexus.profile.${index}`
    }));
    expect(saveProviderProfiles(many, storage)).toMatchObject({ ok: false });
  });

  it("rejects two profiles that point at the same dedicated credential entry", () => {
    const handle = "profile-0123456789abcdef0123456789abcdef";
    const first = {
      ...ollama,
      id: "nexus.cloud.a",
      settings: { ...ollama.settings, baseUrl: "https://a.example/v1", model: "model-a", inferenceLocation: "remote" as const, credentialHandle: handle }
    };
    const second = {
      ...ollama,
      id: "nexus.cloud.b",
      settings: { ...ollama.settings, baseUrl: "https://b.example/v1", model: "model-b", inferenceLocation: "remote" as const, credentialHandle: handle }
    };
    const storage = new MemoryStorage();
    expect(saveProviderProfiles([first, second], storage)).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(upsertProviderProfile([first], second)).toMatchObject({ ok: false, error: { code: "validation" } });
    storage.setItem("nexus-au:provider-profiles:v1", JSON.stringify({ schemaVersion: 1, profiles: [first, second] }));
    expect(loadProviderProfiles(storage)).toMatchObject({ ok: false, error: { code: "validation" } });
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
