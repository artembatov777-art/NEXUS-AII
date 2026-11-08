import { err, ok, type Result } from "../core/result";
import type { StorageLike } from "./memoryStorage";

const STORAGE_KEY = "nexus-au:agent-profile:v1";

export interface AgentProfile {
  schemaVersion: 1;
  agentId: string;
  name: string;
  revision: number;
  maxSteps: number;
  timeoutMs: number;
  updatedAt: number;
}

export const DEFAULT_AGENT_PROFILE: AgentProfile = {
  schemaVersion: 1,
  agentId: "nexus.local-workflow",
  name: "Local workflow demo",
  revision: 1,
  maxSteps: 3,
  timeoutMs: 15_000,
  updatedAt: 0
};

export function validateAgentProfile(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Agent profile must be an object.";
  const profile = value as Partial<AgentProfile>;
  if (profile.schemaVersion !== 1 || profile.agentId !== DEFAULT_AGENT_PROFILE.agentId) return "Unsupported agent profile schema or identity.";
  if (typeof profile.name !== "string" || !profile.name.trim() || profile.name.length > 80) return "Agent name must contain 1 to 80 characters.";
  if (!Number.isSafeInteger(profile.revision) || (profile.revision ?? 0) < 1) return "Agent profile revision is invalid.";
  if (!Number.isInteger(profile.maxSteps) || (profile.maxSteps ?? 0) < 1 || (profile.maxSteps ?? 0) > 20) return "Agent step budget must be from 1 to 20.";
  if (!Number.isInteger(profile.timeoutMs) || (profile.timeoutMs ?? 0) < 1_000 || (profile.timeoutMs ?? 0) > 60_000) return "Agent timeout must be from 1,000 to 60,000 ms.";
  if (!Number.isFinite(profile.updatedAt) || (profile.updatedAt ?? -1) < 0) return "Agent profile timestamp is invalid.";
  return null;
}

export function loadAgentProfile(storage: StorageLike): Result<AgentProfile> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return ok(DEFAULT_AGENT_PROFILE);
    const parsed: unknown = JSON.parse(raw);
    const validation = validateAgentProfile(parsed);
    return validation ? err("storage_failed", validation) : ok(parsed as AgentProfile);
  } catch {
    return err("storage_failed", "Could not read the saved agent profile.");
  }
}

export function saveAgentProfile(storage: StorageLike, profile: AgentProfile): Result<void> {
  const validation = validateAgentProfile(profile);
  if (validation) return err("validation", validation);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(profile));
    return ok(undefined);
  } catch {
    return err("storage_failed", "Could not persist the agent profile.", true);
  }
}
