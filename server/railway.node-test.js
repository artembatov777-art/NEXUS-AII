import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNexusServer } from "./railway.js";

async function withServer(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nexus-railway-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), "<!doctype html><title>NEXUS test</title>");
  const server = createNexusServer({ staticDir: directory });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

test("persistent mount verification ignores the container root and accepts a mounted data volume", async () => {
  const { isCoveredByPersistentMount } = await import("./persistentVolume.js");
  const mountInfo = [
    "24 1 0:22 / / rw,relatime - overlay overlay rw",
    "25 24 0:31 / /data rw,relatime - ext4 /dev/volume rw"
  ].join("\n");
  assert.equal(isCoveredByPersistentMount("/data", mountInfo), true);
  assert.equal(isCoveredByPersistentMount("/data/provider-profiles", mountInfo), true);
  assert.equal(isCoveredByPersistentMount("/app/data", mountInfo), false);
});

test("persistent mount verification decodes escaped mount paths", async () => {
  const { isCoveredByPersistentMount } = await import("./persistentVolume.js");
  const mountInfo = "25 24 0:31 / /mnt/nexus\\040data rw,relatime - ext4 /dev/volume rw";
  assert.equal(isCoveredByPersistentMount("/mnt/nexus data/profiles", mountInfo), true);
});

test("Railway adapter serves the SPA and health endpoint", async () => {
  await withServer(async baseUrl => {
    const health = await fetch(baseUrl + "/api/health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");

    const page = await fetch(baseUrl + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /NEXUS test/);
  });
});

test("Railway adapter keeps unknown API routes inside the API namespace", async () => {
  await withServer(async baseUrl => {
    const response = await fetch(baseUrl + "/api/not-a-route");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "API route not found." });
  });
});

test("Railway routes Gemini through the shared provider gateway", async () => {
  const previousToken = process.env.NEXUS_API_TOKEN;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  process.env.NEXUS_API_TOKEN = "railway-test-token";
  delete process.env.GEMINI_API_KEY;
  try {
    await withServer(async baseUrl => {
      const response = await fetch(baseUrl + "/api/provider/gemini", {
        method: "POST",
        headers: {
          Authorization: "Bearer railway-test-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "models" })
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "This provider is not configured in the NEXUS server environment." });
    });
  } finally {
    if (previousToken === undefined) delete process.env.NEXUS_API_TOKEN;
    else process.env.NEXUS_API_TOKEN = previousToken;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
});

test("session endpoint reports missing gateway configuration without exposing internals", async () => {
  const previousToken = process.env.NEXUS_API_TOKEN;
  delete process.env.NEXUS_API_TOKEN;
  try {
    await withServer(async baseUrl => {
      const response = await fetch(baseUrl + "/api/session");
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "NEXUS API access is not configured." });
    });
  } finally {
    if (previousToken === undefined) delete process.env.NEXUS_API_TOKEN;
    else process.env.NEXUS_API_TOKEN = previousToken;
  }
});
