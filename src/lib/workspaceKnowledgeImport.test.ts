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

  it("rejects invalid roots and malformed directory listings", async () => {
    await expect(collectWorkspaceKnowledgeFiles(" ", vi.fn())).rejects.toThrow(/approved workspace/);
    await expect(collectWorkspaceKnowledgeFiles("/approved", vi.fn(async () => null))).rejects.toThrow(/invalid data/);
  });
});
