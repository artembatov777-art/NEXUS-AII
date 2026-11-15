import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const FILE_NAME = "provider-profiles.json";
const MAX_PROFILES = 16;
const MAX_FILE_BYTES = 64 * 1024;
let writeQueue = Promise.resolve();

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value, max) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function validEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (["/api/provider/gemini", "/api/provider/groq", "/api/provider/nvidia"].includes(value)) return true;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    const host = url.hostname.toLowerCase();
    return url.protocol === "http:" && (
      host === "localhost" || host === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(host)
    );
  } catch {
    return false;
  }
}

function normalizeProfile(value) {
  if (!isRecord(value) || !validText(value.id, 128) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value.id) ||
      !validText(value.label, 80) || !isRecord(value.settings)) {
    throw new Error("A saved provider profile has an invalid identity or label.");
  }
  const settings = value.settings;
  const handle = settings.credentialHandle === undefined ? "default" : settings.credentialHandle;
  const validHandle = handle === "default" || handle === "ollama" || handle === "none" ||
    (typeof handle === "string" && /^profile-[a-f0-9]{32}$/.test(handle));
  if (!validEndpoint(settings.baseUrl) || typeof settings.model !== "string" ||
      settings.model.length > 128 || /[\u0000-\u001f\u007f]/.test(settings.model) ||
      !["local", "remote"].includes(settings.inferenceLocation) || !validHandle ||
      (handle === "none" && !/^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(:\d+)?\//i.test(settings.baseUrl))) {
    throw new Error("A saved provider profile contains unsupported settings.");
  }
  if (settings.providerProtocol !== undefined && settings.providerProtocol !== "anthropic-messages") {
    throw new Error("A saved provider profile contains an unsupported protocol.");
  }
  if (settings.routeMode !== undefined && settings.routeMode !== "manual") {
    throw new Error("A saved provider profile contains an unsupported routing mode.");
  }
  if (value.updatedAt !== undefined && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0)) {
    throw new Error("A saved provider profile has an invalid update timestamp.");
  }
  return {
    id: value.id,
    label: value.label.trim(),
    settings: {
      baseUrl: settings.baseUrl.trim(),
      model: settings.model,
      inferenceLocation: settings.inferenceLocation,
      credentialHandle: handle,
      ...(settings.providerProtocol === "anthropic-messages" ? { providerProtocol: "anthropic-messages" } : {}),
      ...(settings.routeMode === "manual" ? { routeMode: "manual" } : {})
    },
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt })
  };
}

export function normalizeProviderProfiles(value) {
  if (!Array.isArray(value) || value.length > MAX_PROFILES) {
    throw new Error(`A maximum of ${MAX_PROFILES} provider profiles can be stored.`);
  }
  const ids = new Set();
  const handles = new Set();
  const profiles = value.map(normalizeProfile);
  for (const profile of profiles) {
    if (ids.has(profile.id)) throw new Error("Saved provider profile IDs must be unique.");
    ids.add(profile.id);
    const handle = profile.settings.credentialHandle;
    if (typeof handle === "string" && handle.startsWith("profile-")) {
      if (handles.has(handle)) throw new Error("Dedicated credential handles must be unique.");
      handles.add(handle);
    }
  }
  return profiles;
}

function dataFile() {
  const configured = process.env.NEXUS_DATA_DIR;
  if (!configured || !path.isAbsolute(configured)) {
    const error = new Error("Cloud profile storage is not configured. Attach a persistent Railway volume at /data and set NEXUS_DATA_DIR=/data.");
    error.code = "STORAGE_NOT_CONFIGURED";
    throw error;
  }
  return path.join(path.resolve(configured), FILE_NAME);
}

async function readStore() {
  const file = dataFile();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return [];
    throw error;
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) {
    throw new Error("The saved provider profile store exceeds its size limit.");
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("The saved provider profile store is invalid. Existing data was left untouched."); }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error("The saved provider profile store has an unsupported schema.");
  }
  return normalizeProviderProfiles(parsed.profiles);
}

async function writeStore(profiles) {
  const file = dataFile();
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const payload = JSON.stringify({ schemaVersion: 1, profiles });
  if (Buffer.byteLength(payload, "utf8") > MAX_FILE_BYTES) {
    throw new Error("The saved provider profiles exceed the storage size limit.");
  }
  const temporary = path.join(directory, `.provider-profiles-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    const { unlink } = await import("node:fs/promises");
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function loadProviderProfilesFromServer() {
  return readStore();
}

export async function saveProviderProfilesToServer(profiles) {
  const normalized = normalizeProviderProfiles(profiles);
  const operation = writeQueue.then(() => writeStore(normalized));
  writeQueue = operation.catch(() => undefined);
  await operation;
  return normalized;
}
