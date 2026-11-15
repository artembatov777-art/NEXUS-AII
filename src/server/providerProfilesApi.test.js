import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import handler from "../../api/profiles.js";

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value = "") { this.body = value; },
    json() { return JSON.parse(this.body); }
  };
}

function request(method = "GET", body, headers = {}) {
  return { method, headers: { authorization: "Bearer nexus-test-token", ...headers }, body };
}

const profile = {
  id: "nexus.groq",
  label: "Groq",
  settings: {
    baseUrl: "/api/provider/groq",
    model: "openai/gpt-oss-20b",
    inferenceLocation: "remote",
    credentialHandle: "default",
  },
  updatedAt: 100
};

describe("authenticated cloud provider profile API", () => {
  let directory;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "nexus-profiles-"));
    vi.stubEnv("NEXUS_API_TOKEN", "nexus-test-token");
    vi.stubEnv("NEXUS_DATA_DIR", directory);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects unauthenticated reads and writes", async () => {
    const read = response();
    await handler(request("GET", undefined, { authorization: "Bearer wrong" }), read);
    expect(read.statusCode).toBe(401);
    const write = response();
    await handler(request("PUT", { schemaVersion: 1, profiles: [] }, { authorization: "Bearer wrong" }), write);
    expect(write.statusCode).toBe(401);
  });

  it("returns a valid empty collection before the first profile is saved", async () => {
    const read = response();
    await handler(request("GET"), read);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ schemaVersion: 1, profiles: [], deletedProfileIds: [] });
  });

  it("saves profiles durably and returns them to another device session", async () => {
    const write = response();
    await handler(request("PUT", { schemaVersion: 1, profiles: [profile] }), write);
    expect(write.statusCode).toBe(200);
    expect(write.json()).toMatchObject({ saved: true, profiles: [profile] });

    const read = response();
    await handler(request("GET"), read);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ schemaVersion: 1, profiles: [profile], deletedProfileIds: [] });

    const raw = await readFile(path.join(directory, "provider-profiles.json"), "utf8");
    expect(raw).not.toContain("apiKey");
  });

  it("rejects invalid profiles without replacing the previous store", async () => {
    const initial = response();
    await handler(request("PUT", { schemaVersion: 1, profiles: [profile] }), initial);
    const invalid = response();
    await handler(request("PUT", {
      schemaVersion: 1,
      profiles: [{ ...profile, settings: { ...profile.settings, baseUrl: "javascript:alert(1)" } }]
    }), invalid);
    expect(invalid.statusCode).toBe(400);
    const read = response();
    await handler(request("GET"), read);
    expect(read.json().profiles).toEqual([profile]);
  });

  it("persists deletion tombstones so another device cannot restore deleted profiles", async () => {
    const write = response();
    await handler(request("PUT", {
      schemaVersion: 1,
      profiles: [],
      deletedProfileIds: ["nexus.groq"]
    }), write);
    expect(write.statusCode).toBe(200);
    const read = response();
    await handler(request("GET"), read);
    expect(read.json()).toMatchObject({ profiles: [], deletedProfileIds: ["nexus.groq"] });
  });

  it("fails closed when a persistent volume has not been configured", async () => {
    vi.stubEnv("NEXUS_DATA_DIR", "");
    const read = response();
    await handler(request("GET"), read);
    expect(read.statusCode).toBe(503);
    expect(read.json().code).toBe("STORAGE_NOT_CONFIGURED");
  });

  it("rejects unsupported methods", async () => {
    const res = response();
    await handler(request("DELETE"), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe("GET, PUT");
  });
});
