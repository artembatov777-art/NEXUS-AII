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
