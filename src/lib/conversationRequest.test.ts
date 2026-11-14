import { describe, expect, it } from "vitest";
import { prepareConversationRequest } from "./conversationRequest";
import type { ModelMessage } from "../core/model";

const message = (role: ModelMessage["role"], content: string): ModelMessage => ({ role, content });

describe("prepareConversationRequest", () => {
  it("keeps the newest contiguous history within the model message-count limit", () => {
    const history = Array.from({ length: 140 }, (_, index) => message(index % 2 ? "assistant" : "user", "turn-" + index));
    const prepared = prepareConversationRequest(history);
    expect(prepared.messages).toHaveLength(100);
    expect(prepared.messages[0]?.role).toBe("system");
    expect(prepared.messages[0]?.content).toContain("Older conversation turns were omitted");
    expect(prepared.messages[1]?.content).toBe("turn-41");
    expect(prepared.messages.at(-1)?.content).toBe("turn-139");
    expect(prepared.omittedMessageCount).toBe(41);
  });

  it("reserves a system slot and budget for retrieved reference context", () => {
    const history = Array.from({ length: 120 }, (_, index) => message(index % 2 ? "assistant" : "user", "turn-" + index));
    const prepared = prepareConversationRequest(history, "owner-approved project notes");
    expect(prepared.messages).toHaveLength(100);
    expect(prepared.messages[0]?.role).toBe("system");
    expect(prepared.messages[0]?.content).toContain("untrusted reference data");
    expect(prepared.messages.at(-1)?.content).toBe("turn-119");
    expect(prepared.omittedMessageCount).toBe(21);
  });

  it("drops older turns when the UTF-8 content budget is reached", () => {
    const history = Array.from({ length: 11 }, (_, index) =>
      message(index % 2 ? "assistant" : "user", String(index).padEnd(90_000, "x"))
    );
    const prepared = prepareConversationRequest(history);
    expect(prepared.messages).toHaveLength(10);
    expect(prepared.messages[0]?.role).toBe("system");
    expect(prepared.messages[0]?.content).toContain("Older conversation turns were omitted");
    expect(prepared.messages[1]?.content).toBe(history[2]?.content);
    expect(prepared.messages.at(-1)?.content).toBe(history.at(-1)?.content);
    expect(prepared.omittedMessageCount).toBe(2);
    expect(prepared.includedContentBytes).toBeLessThanOrEqual(900_000);
  });

  it("rejects a latest message larger than the native per-message limit", () => {
    expect(() => prepareConversationRequest([message("user", "я".repeat(60_000))])).toThrow(/100 KB/);
  });

  it("rejects invalid or empty conversation history", () => {
    expect(() => prepareConversationRequest([])).toThrow(/at least one message/);
    expect(() => prepareConversationRequest([message("tool", "unsupported")])).toThrow(/invalid message/);
  });
});
