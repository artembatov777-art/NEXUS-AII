import { describe, expect, it } from "vitest";
import { normalizeProviderModelIds, providerEndpointError } from "./providerEndpoint";

describe("provider endpoint validation", () => {
  it("accepts HTTPS provider URLs", () => {
    expect(providerEndpointError("https://gateway.example/v1")).toBeNull();
  });

  it.each([
    "http://localhost:20128/v1",
    "http://127.0.0.1:11434/v1",
    "http://127.23.4.5:11434/v1",
    "http://[::1]:11434/v1"
  ])("accepts loopback HTTP endpoint %s", url => {
    expect(providerEndpointError(url)).toBeNull();
  });

  it.each([
    "http://gateway.example/v1",
    "http://127.999.1.1:11434/v1",
    "ftp://localhost/v1",
    "not a URL",
    "https://user:secret@gateway.example/v1",
    "https://gateway.example/v1?token=secret",
    "https://gateway.example/v1#fragment"
  ])("rejects unsafe or malformed endpoint %s", url => {
    expect(providerEndpointError(url)).not.toBeNull();
  });
});

describe("provider model catalog normalization", () => {
  it("filters invalid IDs, trims whitespace, and removes duplicates", () => {
    expect(normalizeProviderModelIds([
      " model-a ", "model-a", "", "  ", 42, "x".repeat(129), "bad\nmodel", "model-b"
    ])).toEqual(["model-a", "model-b"]);
  });

  it("returns an empty list for non-array payloads", () => {
    expect(normalizeProviderModelIds({ data: [] })).toEqual([]);
  });
});
