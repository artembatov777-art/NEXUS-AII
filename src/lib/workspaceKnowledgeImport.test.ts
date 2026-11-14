import { describe, expect, it, vi } from "vitest";
import { collectWorkspaceKnowledgeFiles } from "./workspaceKnowledgeImport";

describe("collectWorkspaceKnowledgeFiles", () => {
  it("collects nested supported text files and skips binary or oversized entries", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      if (args?.path === "C:\\Work") return [
        { name: "src", path: "C:\\Work\\src", kind: "directory", sizeBytes: 0 },
        { name: "diagram.png", path: "C:\\Work\\diagram.png", kind: "file", sizeBytes: 100 },
        { name: "large.ts", path: "C:\\Work\\large.ts", kind: "file", sizeBytes: 3 * 1024 * 1024 }
      ];
      if (args?.path === "C:\\Work\\src") return [
        { name: "main.ts", path: "C:\\Work\\src\\main.ts", kind: "file", sizeBytes: 200 },
        { name: "Cargo.toml", path: "C:\\Work\\src\\Cargo.toml", kind: "file", sizeBytes: 80 }
      ];
      return [];
    });
    const result = await collectWorkspaceKnowledgeFiles("C:\\Work", invoke);
    expect(result.files.map(file => file.name)).toEqual(["Cargo.toml", "main.ts"]);
    expect(result.skippedFiles).toBe(2);
    expect(result.totalBytes).toBe(280);
  });

  it("rejects paths that escape the approved root and does not recurse into them", async () => {
    const invoke = vi.fn(async () => [
      { name: "outside", path: "/approved-evil", kind: "directory", sizeBytes: 0 },
      { name: "secret.txt", path: "/outside/secret.txt", kind: "file", sizeBytes: 10 }
    ]);
    const result = await collectWorkspaceKnowledgeFiles("/approved", invoke);
    expect(result.files).toEqual([]);
    expect(result.skippedFiles).toBe(2);
    expect(invoke).toHaveBeenCalledTimes(1);
  });


  it("preserves case-sensitive Unix directory names during recursive scans", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      if (args?.path === "/Approved") return [
        { name: "Case", path: "/Approved/Case", kind: "directory", sizeBytes: 0 },
        { name: "case", path: "/Approved/case", kind: "directory", sizeBytes: 0 }
      ];
      if (args?.path === "/Approved/Case") return [
        { name: "upper.txt", path: "/Approved/Case/upper.txt", kind: "file", sizeBytes: 1 }
      ];
      if (args?.path === "/Approved/case") return [
        { name: "lower.txt", path: "/Approved/case/lower.txt", kind: "file", sizeBytes: 1 }
      ];
      return [];
    });
    const result = await collectWorkspaceKnowledgeFiles("/Approved", invoke);
    expect(result.files.map(file => file.name)).toEqual(["lower.txt", "upper.txt"]);
  });


  it("skips credential directories and likely secret files before reading content", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      if (args?.path === "/approved") return [
        { name: ".ssh", path: "/approved/.ssh", kind: "directory", sizeBytes: 0 },
        { name: ".git", path: "/approved/.git", kind: "directory", sizeBytes: 0 },
        { name: ".env", path: "/approved/.env", kind: "file", sizeBytes: 20 },
        { name: "id_ed25519", path: "/approved/id_ed25519", kind: "file", sizeBytes: 100 },
        { name: "notes.md", path: "/approved/notes.md", kind: "file", sizeBytes: 10 }
      ];
      return [];
    });
    const result = await collectWorkspaceKnowledgeFiles("/approved", invoke);
    expect(result.files.map(file => file.name)).toEqual(["notes.md"]);
    expect(result.skippedFiles).toBe(4);
    expect(invoke).toHaveBeenCalledTimes(1);
  });


  it("caps a scan at 100 files and reports the truncated result", async () => {
    const entries = Array.from({ length: 101 }, (_, index) => ({
      name: "file-" + index + ".txt", path: "/approved/file-" + index + ".txt",
      kind: "file", sizeBytes: 10
    }));
    const result = await collectWorkspaceKnowledgeFiles("/approved", vi.fn(async () => entries));
    expect(result.files).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(result.totalBytes).toBe(1_000);
  });

  it("compares Windows paths case-insensitively without accepting sibling prefixes", async () => {
    const invoke = vi.fn(async () => [
      { name: "notes.txt", path: "c:\\work\\notes.txt", kind: "file", sizeBytes: 5 },
      { name: "escape.txt", path: "C:\\work-evil\\escape.txt", kind: "file", sizeBytes: 5 }
    ]);
    const result = await collectWorkspaceKnowledgeFiles("C:\\Work", invoke);
    expect(result.files.map(file => file.name)).toEqual(["notes.txt"]);
    expect(result.skippedFiles).toBe(1);
  });

  it("rejects invalid roots and malformed directory listings", async () => {
    await expect(collectWorkspaceKnowledgeFiles(" ", vi.fn())).rejects.toThrow(/approved workspace/);
    await expect(collectWorkspaceKnowledgeFiles("/approved", vi.fn(async () => null))).rejects.toThrow(/invalid data/);
  });
});
