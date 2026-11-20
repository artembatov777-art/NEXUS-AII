import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink, truncate, writeFile, access } from "node:fs/promises";
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

  it("refuses a stale CLI session write instead of overwriting another process's conversation", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "history.json");
      await saveHistory(path, valid);
      const first = [...valid, { role: "user" as const, content: "First follow-up" },
        { role: "assistant" as const, content: "First reply" }];
      const stale = [...valid, { role: "user" as const, content: "Stale follow-up" },
        { role: "assistant" as const, content: "Stale reply" }];
      await saveHistory(path, first);
      await expect(saveHistory(path, stale)).rejects.toThrow(/history.*changed|stale|conflict/i);
      expect(await loadHistory(path)).toEqual(first);
      await expect(access(path + ".lock")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("serializes concurrent history writes and preserves the winning completed turn", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "history.json");
      await saveHistory(path, valid);
      const first = [...valid, { role: "user" as const, content: "Alpha" },
        { role: "assistant" as const, content: "One" }];
      const second = [...valid, { role: "user" as const, content: "Beta" },
        { role: "assistant" as const, content: "Two" }];
      const results = await Promise.allSettled([saveHistory(path, first), saveHistory(path, second)]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const saved = await loadHistory(path);
      expect(saved.length).toBe(4);
      expect(saved).toEqual(results[0].status === "fulfilled" ? first : second);
      await expect(access(path + ".lock")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("does not overwrite a corrupted existing history file just to save a valid new turn", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "history.json");
      await writeFile(path, "broken history");
      await expect(saveHistory(path, valid)).rejects.toThrow(/history.*format|invalid.*history/i);
      expect(await readFile(path, "utf8")).toBe("broken history");
    });
  });

  it("does not remove a prior writer's lock or clobber a symbolic-link history", async () => {
    await withTempDir(async directory => {
      const path = join(directory, "history.json");
      const locked = path + ".lock";
      await writeFile(locked, "existing writer\n", { flag: "wx", mode: 0o600 });
      await expect(saveHistory(path, valid)).rejects.toThrow(/lock|busy|another|history/i);
      expect(await readFile(locked, "utf8")).toBe("existing writer\n");
      await rm(locked);
      if (process.platform !== "win32") {
        const target = join(directory, "target.json");
        await writeFile(target, "leave untouched", { mode: 0o600 });
        await symlink(target, path);
        await expect(saveHistory(path, valid)).rejects.toThrow();
        expect(await readFile(target, "utf8")).toBe("leave untouched");
      }
    });
  });
});
