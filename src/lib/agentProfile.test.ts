import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_PROFILE, loadAgentProfile, saveAgentProfile, validateAgentProfile } from "./agentProfile";
import type { StorageLike } from "./memoryStorage";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("agent profile persistence", () => {
  it("loads defaults and persists validated editable budgets", () => {
    const storage = new MemoryStorage();
    expect(loadAgentProfile(storage)).toMatchObject({ ok: true, value: DEFAULT_AGENT_PROFILE });
    const profile = { ...DEFAULT_AGENT_PROFILE, name: "Release workflow", revision: 2, maxSteps: 7, timeoutMs: 30_000, updatedAt: 100 };
    expect(saveAgentProfile(storage, profile)).toMatchObject({ ok: true });
    expect(loadAgentProfile(storage)).toMatchObject({ ok: true, value: profile });
  });

  it("rejects invalid budgets and corrupt stored profile data", () => {
    expect(validateAgentProfile({ ...DEFAULT_AGENT_PROFILE, maxSteps: 0 })).toContain("step budget");
    const storage = new MemoryStorage();
    storage.setItem("nexus-au:agent-profile:v1", "{broken");
    expect(loadAgentProfile(storage)).toMatchObject({ ok: false, error: { code: "storage_failed" } });
  });
});
