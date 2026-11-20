import { describe, expect, it } from "vitest";
import { renderHistoryCommand } from "./historyView";
import type { ModelMessage } from "../src/core/model";

const sample: ModelMessage[] = [
  { role: "user", content: "Alpha request" },
  { role: "assistant", content: "Alpha answer" },
  { role: "user", content: "Beta request" },
  { role: "assistant", content: "Beta answer" },
  { role: "user", content: "Gamma request" },
  { role: "assistant", content: "Gamma answer" }
];

describe("read-only terminal conversation inspection", () => {
  it("shows completed turns and preserves relative turn indexes", () => {
    const output = renderHistoryCommand("/history", sample);
    expect(output).toContain("3 completed turns");
    expect(output).toContain("Turn 1");
    expect(output).toContain("Alpha request");
    expect(output).toContain("Gamma answer");
    expect(output).not.toContain("TEST MODEL");
    expect(sample).toHaveLength(6);
  });

  it("displays only the most recent N turns without mutating history", () => {
    const output = renderHistoryCommand("/history last 2", sample);
    expect(output).toContain("Turn 2");
    expect(output).toContain("Turn 3");
    expect(output).not.toContain("Alpha request");
    expect(sample[0].content).toBe("Alpha request");
  });

  it("searches both roles case-insensitively and does not disclose unrelated turns", () => {
    const output = renderHistoryCommand("/history find bEtA", sample);
    expect(output).toContain("1 matching turn");
    expect(output).toContain("Beta request");
    expect(output).toContain("Beta answer");
    expect(output).not.toContain("Alpha request");
  });

  it("escapes ANSI, bidirectional controls and multiline content", () => {
    const output = renderHistoryCommand("/history", [
      { role: "user", content: "hello\u001b[31m\u202esecret\nnext" },
      { role: "assistant", content: "reply" }
    ]);
    expect(output).toContain("\\u001b");
    expect(output).toContain("\\u202e");
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\u202e");
    expect(output).not.toContain("hello\nnext");
  });

  it("bounds previews and search result counts", () => {
    const records: ModelMessage[] = [];
    for (let i = 0; i < 40; i++) {
      records.push({ role: "user", content: "findme " + "x".repeat(5_000) + i });
      records.push({ role: "assistant", content: "response " + i });
    }
    const output = renderHistoryCommand("/history find findme", records);
    expect(output).toContain("40 matching turns");
    expect(output.length).toBeLessThan(5_000);
    expect(output).toContain("Turn 40");
    expect(output).not.toContain("Turn 1\n");
  });

  it("handles empty and incomplete local sessions without inventing successful turns", () => {
    expect(renderHistoryCommand("/history", [])).toContain("No completed turns");
    expect(renderHistoryCommand("/history", [{ role: "user", content: "unfinished" }]))
      .toContain("No completed turns");
    expect(renderHistoryCommand("/history find missing", sample)).toContain("No matching turns");
  });

  it("rejects invalid limits and search syntax without invoking a model", () => {
    for (const input of ["/history last 0", "/history last 26", "/history find", "/history find " + "x".repeat(81), "/history delete", "/history last 2 extra"]) {
      expect(renderHistoryCommand(input, sample)).toContain("Usage: /history");
    }
    expect(renderHistoryCommand("/agent task", sample)).toBeNull();
  });
});
