import { describe, expect, it } from "vitest";
import {
  createProfileCredentialHandle, isDedicatedCredentialHandle, isValidCredentialHandle
} from "./providerCredentials";

describe("provider credential handles", () => {
  it("creates unique bounded dedicated handles", () => {
    const first = createProfileCredentialHandle();
    const second = createProfileCredentialHandle();
    expect(first).toMatch(/^profile-[a-f0-9]{32}$/);
    expect(second).toMatch(/^profile-[a-f0-9]{32}$/);
    expect(second).not.toBe(first);
  });

  it("accepts only the shared slots, loopback no-key mode, and exact dedicated format", () => {
    expect(isValidCredentialHandle("default")).toBe(true);
    expect(isValidCredentialHandle("ollama")).toBe(true);
    expect(isValidCredentialHandle("none")).toBe(true);
    expect(isValidCredentialHandle("profile-0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isDedicatedCredentialHandle("profile-0123456789abcdef0123456789abcdef")).toBe(true);
    for (const invalid of ["", "unknown", "profile-../secret", "profile-0123456789ABCDEF0123456789ABCDEF", "profile-0123456789abcdef", "profile-0123456789abcdef0123456789abcdef\n"]) {
      expect(isValidCredentialHandle(invalid)).toBe(false);
      expect(isDedicatedCredentialHandle(invalid)).toBe(false);
    }
  });
});
