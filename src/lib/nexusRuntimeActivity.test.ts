import { describe, expect, it } from "vitest";
import { createNexusRuntime } from "./nexusRuntime";
import type { StorageLike } from "./memoryStorage";

describe("runtime activity journal wiring", () => {
  it("uses the same persistent browser storage across runtime instances", async () => {
    const memory = new Map<string, string>();
    const storage: StorageLike = {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); }
    };
    const first = createNexusRuntime({ storage, actorId: "local-owner" });
    expect((await first.activityRepository.append({
      runId: "run", conversationId: "chat", kind: "started", timestamp: 1
    })).ok).toBe(true);
    const second = createNexusRuntime({ storage, actorId: "local-owner" });
    const result = await second.activityRepository.listByConversation("chat", 10);
    expect(result).toMatchObject({ ok: true, value: [
      { runId: "run", conversationId: "chat", kind: "started", timestamp: 1 }
    ] });
  });
});
