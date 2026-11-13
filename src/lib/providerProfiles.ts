import { err, ok, type Result } from "../core/result";
import type { ProviderSettings } from "../types";
import type { StorageAdapter } from "./storage";
import { isLoopbackProviderEndpoint, providerEndpointError } from "./providerEndpoint";

export interface ProviderProfileRecord {
  id: string;
  label: string;
  settings: ProviderSettings;
}

const STORAGE_KEY = "nexus-au:provider-profiles:v1";
const MAX_PROFILES = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

export function validateProviderProfile(value: unknown): Result<ProviderProfileRecord> {
  if (!isRecord(value) || !boundedText(value.id, 128) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.id) ||
      !boundedText(value.label, 80) || !isRecord(value.settings)) {
    return err("validation", "Provider profile identity, label, or settings are invalid.");
  }

  const settings = value.settings;
  if (typeof settings.baseUrl !== "string" || settings.baseUrl.length > 2048 ||
      providerEndpointError(settings.baseUrl) ||
      typeof settings.model !== "string" || settings.model.length > 128 ||
      new TextEncoder().encode(settings.model).byteLength > 128 ||
      (settings.model.length > 0 && !boundedText(settings.model, 128)) ||
      !["local", "remote"].includes(String(settings.inferenceLocation))) {
    return err("validation", "Provider profile endpoint, model, or inference location is invalid.");
  }

  const credentialHandle = settings.credentialHandle === undefined ? "default" : settings.credentialHandle;
  if (!["default", "ollama", "none"].includes(String(credentialHandle))) {
    return err("validation", "Provider profile credential handle is unsupported.");
  }
  if (credentialHandle === "none" && !isLoopbackProviderEndpoint(settings.baseUrl)) {
    return err("permission_denied", "No-key provider profiles are restricted to localhost or loopback endpoints.");
  }

  // Copy only allowlisted fields. API keys and arbitrary properties are never persisted.
  return ok({
    id: value.id,
    label: value.label.trim(),
    settings: {
      baseUrl: settings.baseUrl.trim(),
      model: settings.model,
      inferenceLocation: settings.inferenceLocation as ProviderSettings["inferenceLocation"],
      credentialHandle: credentialHandle as NonNullable<ProviderSettings["credentialHandle"]>
    }
  });
}

export function loadProviderProfiles(storage: StorageAdapter = localStorage): Result<ProviderProfileRecord[]> {
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { return err("storage_failed", "Saved provider profiles could not be read."); }
  if (raw === null) return ok([]);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return err("validation", "Saved provider profiles contain invalid JSON. Existing data was left untouched."); }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.profiles) ||
      parsed.profiles.length > MAX_PROFILES) {
    return err("validation", "Saved provider profile data has an unsupported schema or exceeds the profile limit.");
  }
  const profiles: ProviderProfileRecord[] = [];
  const ids = new Set<string>();
  for (const item of parsed.profiles) {
    const validated = validateProviderProfile(item);
    if (!validated.ok) return validated;
    if (ids.has(validated.value.id)) return err("validation", "Saved provider profiles contain duplicate IDs.");
    ids.add(validated.value.id);
    profiles.push(validated.value);
  }
  return ok(profiles);
}

export function saveProviderProfiles(
  profiles: ProviderProfileRecord[],
  storage: StorageAdapter = localStorage
): Result<void> {
  if (!Array.isArray(profiles) || profiles.length > MAX_PROFILES) {
    return err("validation", `A maximum of ${MAX_PROFILES} provider profiles can be saved.`);
  }
  const normalized: ProviderProfileRecord[] = [];
  const ids = new Set<string>();
  for (const item of profiles) {
    const validated = validateProviderProfile(item);
    if (!validated.ok) return validated;
    if (ids.has(validated.value.id)) return err("validation", "Provider profile IDs must be unique.");
    ids.add(validated.value.id);
    normalized.push(validated.value);
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, profiles: normalized }));
    return ok(undefined);
  } catch {
    return err("storage_failed", "Provider profiles could not be saved.");
  }
}

export function upsertProviderProfile(
  profiles: ProviderProfileRecord[],
  profile: unknown
): Result<ProviderProfileRecord[]> {
  if (!Array.isArray(profiles)) return err("validation", "Provider profile collection is invalid.");
  const validated = validateProviderProfile(profile);
  if (!validated.ok) return validated;
  const exists = profiles.some(item => item.id === validated.value.id);
  if (!exists && profiles.length >= MAX_PROFILES) return err("validation", `A maximum of ${MAX_PROFILES} provider profiles can be saved.`);
  return ok(exists
    ? profiles.map(item => item.id === validated.value.id ? validated.value : item)
    : [...profiles, validated.value]);
}

export function removeProviderProfile(
  profiles: ProviderProfileRecord[],
  profileId: string
): Result<ProviderProfileRecord[]> {
  if (!Array.isArray(profiles) || !boundedText(profileId, 128)) {
    return err("validation", "Provider profile collection or ID is invalid.");
  }
  return ok(profiles.filter(item => item.id !== profileId));
}
