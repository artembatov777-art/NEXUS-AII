import { describe, expect, it } from "vitest";
import { decryptWorkspaceBackup, encryptWorkspaceBackup, isEncryptedWorkspaceBackup } from "./workspaceBackupCrypto";

describe("encrypted workspace backups", () => {
  it("round-trips a workspace payload using authenticated encryption", async () => {
    const payload = {
      format: "nexus-au-backup", schemaVersion: 2,
      projects: [{ id: "project-1", name: "Private project" }],
      conversations: [{ id: "conversation-1", messages: [{ role: "user", content: "private text" }] }]
    };
    const encrypted = JSON.parse(await encryptWorkspaceBackup(payload, "correct horse battery staple"));
    expect(isEncryptedWorkspaceBackup(encrypted)).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain("Private project");
    expect(JSON.stringify(encrypted)).not.toContain("private text");
    await expect(decryptWorkspaceBackup(encrypted, "correct horse battery staple")).resolves.toEqual(payload);
  });

  it("rejects an incorrect passphrase and tampered ciphertext", async () => {
    const encrypted = JSON.parse(await encryptWorkspaceBackup({ format: "nexus-au-backup", schemaVersion: 2 }, "correct horse battery staple"));
    await expect(decryptWorkspaceBackup(encrypted, "incorrect passphrase")).rejects.toThrow(/passphrase/i);
    const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA" };
    await expect(decryptWorkspaceBackup(tampered, "correct horse battery staple")).rejects.toThrow(/passphrase/i);
  });

  it("continues to import legacy version-one encrypted backups", async () => {
    const payload = { format: "nexus-au-backup", schemaVersion: 2, legacy: true };
    const passphrase = "correct horse battery staple";
    const salt = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(12).fill(9);
    const iterations = 310_000;
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(payload))
    );
    const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
    const legacyEnvelope = {
      format: "nexus-au-encrypted-backup",
      schemaVersion: 1,
      kdf: "PBKDF2-SHA256",
      iterations,
      cipher: "AES-256-GCM",
      salt: encode(salt),
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(ciphertext))
    };
    await expect(decryptWorkspaceBackup(legacyEnvelope, passphrase)).resolves.toEqual(payload);
  });

  it("authenticates encryption parameters as part of the backup envelope", async () => {
    const encrypted = JSON.parse(await encryptWorkspaceBackup(
      { format: "nexus-au-backup", schemaVersion: 2, value: "private" },
      "correct horse battery staple"
    ));
    const alteredIterations = { ...encrypted, iterations: encrypted.iterations + 1 };
    await expect(decryptWorkspaceBackup(alteredIterations, "correct horse battery staple"))
      .rejects.toThrow(/passphrase|integrity/i);
  });

  it("rejects unsupported envelopes and weak passphrases", async () => {
    expect(isEncryptedWorkspaceBackup({ format: "nexus-au-backup", schemaVersion: 2 })).toBe(false);
    await expect(encryptWorkspaceBackup({ data: true }, "short")).rejects.toThrow(/12/);
    await expect(decryptWorkspaceBackup({}, "correct horse battery staple")).rejects.toThrow(/supported encrypted/);
  });
});
