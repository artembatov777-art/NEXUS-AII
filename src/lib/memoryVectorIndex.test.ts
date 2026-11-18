import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "../core/memory";
import { LOCAL_EMBEDDING_MODEL_ID } from "./knowledgeVectorIndex";
import { planMemoryVectorReconciliation, rankMemoryVectorRows, type MemoryVectorRow } from "./memoryVectorIndex";

const record = (id: string, updatedAt = 10, scope: MemoryRecord["scope"] = "profile", projectId?: string): MemoryRecord => ({
  id: id as MemoryRecord["id"], content: `Memory ${id}`, category: "fact", scope,
  ...(projectId ? { projectId } : {}),
  source: { type: "user_confirmed", label: "Manual" }, tags: [],
  createdAt: 1, updatedAt, schemaVersion: 1
});

const row = (id: string, updatedAt = 10, scope: MemoryRecord["scope"] = "profile", projectId?: string, modelId = LOCAL_EMBEDDING_MODEL_ID): MemoryVectorRow => ({
  id, modelId, scope, ...(projectId ? { projectId } : {}), vector: [1, 0], updatedAt
});

describe("memory vector index planning", () => {
  it("removes vectors for changed, deleted, or retired-model memories", () => {
    const records = [record("current"), record("changed", 11), record("new")];
    const plan = planMemoryVectorReconciliation([
      row("current"), row("changed", 10), row("deleted"), row("retired", 10, "profile", undefined, "old-model")
    ], records);
    expect(plan.staleIds).toEqual(["changed", "deleted", "retired"]);
    expect(plan.missingRecords.map(item => item.id)).toEqual(["changed", "new"]);
  });

  it("isolates project-scoped semantic results and refuses cross-project rows", () => {
    const rows = [
      row("allowed", 10, "project", "project-a"),
      row("private", 10, "project", "project-b"),
      row("profile", 10, "profile")
    ];
    expect(rankMemoryVectorRows(rows, [1, 0], "project", 10, "project-a").map(item => item.id)).toEqual(["allowed"]);
    expect(rankMemoryVectorRows(rows, [1, 0], "project", 10).map(item => item.id)).toEqual([]);
    expect(rankMemoryVectorRows(rows, [1, 0], "profile", 10).map(item => item.id)).toEqual(["profile"]);
  });
});
