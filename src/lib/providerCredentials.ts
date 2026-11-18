const DEDICATED_HANDLE_PATTERN = /^profile-[a-f0-9]{32}$/;

export function isDedicatedCredentialHandle(value: unknown): value is string {
  return typeof value === "string" && value.length === 40 && DEDICATED_HANDLE_PATTERN.test(value);
}

export function isValidCredentialHandle(value: unknown): value is string {
  return value === "default" || value === "ollama" || value === "none" ||
    isDedicatedCredentialHandle(value);
}

export function createProfileCredentialHandle(): string {
  return `profile-${crypto.randomUUID().replace(/-/g, "").toLowerCase()}`;
}
