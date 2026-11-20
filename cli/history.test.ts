import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHistory, saveHistory } from "./history";
import type { ModelMessage } from "../src/core/model";

const valid: ModelMessage[] = [
  { role: "user", content: "Hello" },
  { role: "assistant", content: "World" }
];

async function withTempDir(fn: (path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "nexus-history-safety-"));
  try { await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

describe("CLI history persistence safety", () => {
  it("round-trips complete turns and returns an empty history when no file exists", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "history.json");
      expect(await loadHistory(path)).toEqual([]);
      await saveHistory(path, valid);
      expect(await loadHistory(path)).toEqual(valid);
    });
  });

  it("rejects malformed or incomplete turns before modifying existing history", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "history.json");
      await saveHistory(path, valid);
      const saved = await readFile(path, "utf8");
      for (const messages of [
        [{ role: "user", content: "incomplete" }],
        [{ role: "assistant", content: "unexpected" }, { role: "assistant", content: "wrong pair" }],
        [{ role: "user", content: 5 }, { role: "assistant", content: "bad" }]
      ]) {
        await expect(saveHistory(path, messages as ModelMessage[])).rejects.toThrow(/history.*format|invalid.*history/i);
        expect(await readFile(path, "utf8")).toBe(saved);
      }
    });
  });

  it("does not dereference symbolic links to unrelated files", async () => {
    if (process.platform === "win32") return; // Creating symlinks may require Developer Mode.
    await withTempDir(async directory => {
      const original = join(directory, "original.json");
      const alias = join(directory, "alias.json");
      await saveHistory(original, valid);
      await symlink(original, alias);
      await expect(loadHistory(alias)).rejects.toThrow(/link|regular|history/i);
    });
  });

  it("rejects oversized history files without accepting a partial prefix", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "oversized.json");
      await writeFile(path, '{"version":1,"messages":[]}');
      await truncate(path, 1_000_001);
      await expect(loadHistory(path)).rejects.toThrow(/limit|1 MB|oversized/i);
    });
  });

  it("rejects invalid UTF-8 instead of silently replacing bytes in saved messages", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "encoding.json");
      const prefix = Buffer.from('{"version":1,"messages":[{"role":"user","content":"');
      const suffix = Buffer.from('"},{"role":"assistant","content":"ok"}]}');
      await writeFile(path, Buffer.concat([prefix, Buffer.from([0xc3, 0x28]), suffix]));
      await expect(loadHistory(path)).rejects.toThrow(/UTF-8|encoded|encoding/i);
    });
  });
});
