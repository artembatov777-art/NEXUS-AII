const BACKUP_FORMAT = "nexus-au-encrypted-backup";
const BACKUP_SCHEMA_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;
const MIN_SUPPORTED_ITERATIONS = 310_000;
const MAX_SUPPORTED_ITERATIONS = 1_000_000;
const MAX_PLAINTEXT_BYTES = 35_000_000;
const MAX_CIPHERTEXT_BYTES = 50_000_000;
const MIN_PASSPHRASE_LENGTH = 12;

function backupAdditionalData(iterations: number): Uint8Array {
  return new TextEncoder().encode(
    `${BACKUP_FORMAT}\\0${BACKUP_SCHEMA_VERSION}\\0PBKDF2-SHA256\\0${iterations}\\0AES-256-GCM`
  );
}

interface EncryptedWorkspaceBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  cipher: "AES-256-GCM";
  salt: string;
  iv: string;
  ciphertext: string;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value: string, maxBytes: number): Uint8Array {
  if (!value || value.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Encrypted backup contains invalid encoded data.");
  }
  const binary = atob(value);
  if (binary.length > maxBytes) throw new Error("Encrypted backup exceeds the supported size.");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function validatePassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH || passphrase.length > 1024) {
    throw new Error("Use a backup passphrase between 12 and 1,024 characters.");
  }
}

async function deriveBackupKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure backup encryption is unavailable in this runtime.");
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isEncryptedWorkspaceBackup(value: unknown): value is EncryptedWorkspaceBackup {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const envelope = value as Partial<EncryptedWorkspaceBackup>;
  return envelope.format === BACKUP_FORMAT && envelope.schemaVersion === BACKUP_SCHEMA_VERSION &&
    envelope.kdf === "PBKDF2-SHA256" && typeof envelope.iterations === "number" && Number.isInteger(envelope.iterations) && envelope.iterations >= MIN_SUPPORTED_ITERATIONS && envelope.iterations <= MAX_SUPPORTED_ITERATIONS &&
    envelope.cipher === "AES-256-GCM" && typeof envelope.salt === "string" &&
    typeof envelope.iv === "string" && typeof envelope.ciphertext === "string";
}

/** Encrypts a complete workspace export; the passphrase is never persisted by NEXUS. */
export async function encryptWorkspaceBackup(value: unknown, passphrase: string): Promise<string> {
  validatePassphrase(passphrase);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (!plaintext.length || plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error("Workspace backup is empty or exceeds the 35 MB encrypted-export limit.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveBackupKey(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: backupAdditionalData(PBKDF2_ITERATIONS) }, key, plaintext);
  const envelope: EncryptedWorkspaceBackup = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    cipher: "AES-256-GCM",
    salt: encodeBase64(salt),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(new Uint8Array(ciphertext))
  };
  return JSON.stringify(envelope, null, 2);
}

/** Decrypts only the versioned authenticated backup envelope. */
export async function decryptWorkspaceBackup(value: unknown, passphrase: string): Promise<unknown> {
  validatePassphrase(passphrase);
  if (!isEncryptedWorkspaceBackup(value)) throw new Error("This is not a supported encrypted NEXUS AU backup.");
  try {
    const salt = decodeBase64(value.salt, 16);
    const iv = decodeBase64(value.iv, 12);
    const ciphertext = decodeBase64(value.ciphertext, MAX_CIPHERTEXT_BYTES);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) {
      throw new Error("Encrypted backup metadata is invalid.");
    }
    const key = await deriveBackupKey(passphrase, salt, value.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: backupAdditionalData(value.iterations) }, key, ciphertext);
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) throw new Error("Decrypted backup exceeds the supported size.");
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Could not decrypt the backup. Check the passphrase and file integrity.");
  }
}
