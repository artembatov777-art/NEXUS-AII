import { describe, expect, it } from "vitest";
import { validateAgentCheckpoint, type AgentCheckpoint } from "./agentCheckpoints";

const valid: AgentCheckpoint = {
  schemaVersion: 1,
  runId: "run-1",
  agentId: "agent-1",
  threadId: "thread-1",
  sequence: 1,
  status: "running",
  state: { progress: 1 },
  createdAt: 100,
  updatedAt: 100
};

describe("checkpoint security regression matrix", () => {
  it("rejects U+0000 (NUL) in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "run" + String.fromCharCode(0) + "-1" })).not.toBeNull();
  });
  it("rejects U+0001 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(1) + "-end" })).not.toBeNull();
  });
  it("rejects U+0002 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(2) + "-end" })).not.toBeNull();
  });
  it("rejects U+0003 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(3) + "-end" })).not.toBeNull();
  });
  it("rejects U+0004 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(4) + "-end" })).not.toBeNull();
  });
  it("rejects U+0005 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(5) + "-end" })).not.toBeNull();
  });
  it("rejects U+0006 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(6) + "-end" })).not.toBeNull();
  });
  it("rejects U+0007 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(7) + "-end" })).not.toBeNull();
  });
  it("rejects U+0008 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(8) + "-end" })).not.toBeNull();
  });
  it("rejects U+0009 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(9) + "-end" })).not.toBeNull();
  });
  it("rejects U+000a in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(10) + "-end" })).not.toBeNull();
  });
  it("rejects U+000b in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(11) + "-end" })).not.toBeNull();
  });
  it("rejects U+000c in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(12) + "-end" })).not.toBeNull();
  });
  it("rejects U+000d in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(13) + "-end" })).not.toBeNull();
  });
  it("rejects U+000e in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(14) + "-end" })).not.toBeNull();
  });
  it("rejects U+000f in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(15) + "-end" })).not.toBeNull();
  });
  it("rejects U+0010 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(16) + "-end" })).not.toBeNull();
  });
  it("rejects U+0011 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(17) + "-end" })).not.toBeNull();
  });
  it("rejects U+0012 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(18) + "-end" })).not.toBeNull();
  });
  it("rejects U+0013 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(19) + "-end" })).not.toBeNull();
  });
  it("rejects U+0014 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(20) + "-end" })).not.toBeNull();
  });
  it("rejects U+0015 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(21) + "-end" })).not.toBeNull();
  });
  it("rejects U+0016 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(22) + "-end" })).not.toBeNull();
  });
  it("rejects U+0017 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(23) + "-end" })).not.toBeNull();
  });
  it("rejects U+0018 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(24) + "-end" })).not.toBeNull();
  });
  it("rejects U+0019 in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(25) + "-end" })).not.toBeNull();
  });
  it("rejects U+001a in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(26) + "-end" })).not.toBeNull();
  });
  it("rejects U+001b in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(27) + "-end" })).not.toBeNull();
  });
  it("rejects U+001c in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(28) + "-end" })).not.toBeNull();
  });
  it("rejects U+001d in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(29) + "-end" })).not.toBeNull();
  });
  it("rejects U+001e in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(30) + "-end" })).not.toBeNull();
  });
  it("rejects U+001f in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(31) + "-end" })).not.toBeNull();
  });
  it("rejects U+007f in runId", () => {
    expect(validateAgentCheckpoint({ ...valid, runId: "part" + String.fromCharCode(127) + "-end" })).not.toBeNull();
  });
  it("rejects U+0000 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(0) + "-end" })).not.toBeNull();
  });
  it("rejects U+0001 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(1) + "-end" })).not.toBeNull();
  });
  it("rejects U+0002 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(2) + "-end" })).not.toBeNull();
  });
  it("rejects U+0003 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(3) + "-end" })).not.toBeNull();
  });
  it("rejects U+0004 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(4) + "-end" })).not.toBeNull();
  });
  it("rejects U+0005 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(5) + "-end" })).not.toBeNull();
  });
  it("rejects U+0006 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(6) + "-end" })).not.toBeNull();
  });
  it("rejects U+0007 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(7) + "-end" })).not.toBeNull();
  });
  it("rejects U+0008 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(8) + "-end" })).not.toBeNull();
  });
  it("rejects U+0009 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(9) + "-end" })).not.toBeNull();
  });
  it("rejects U+000a in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(10) + "-end" })).not.toBeNull();
  });
  it("rejects U+000b in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(11) + "-end" })).not.toBeNull();
  });
  it("rejects U+000c in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(12) + "-end" })).not.toBeNull();
  });
  it("rejects U+000d in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(13) + "-end" })).not.toBeNull();
  });
  it("rejects U+000e in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(14) + "-end" })).not.toBeNull();
  });
  it("rejects U+000f in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(15) + "-end" })).not.toBeNull();
  });
  it("rejects U+0010 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(16) + "-end" })).not.toBeNull();
  });
  it("rejects U+0011 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(17) + "-end" })).not.toBeNull();
  });
  it("rejects U+0012 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(18) + "-end" })).not.toBeNull();
  });
  it("rejects U+0013 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(19) + "-end" })).not.toBeNull();
  });
  it("rejects U+0014 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(20) + "-end" })).not.toBeNull();
  });
  it("rejects U+0015 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(21) + "-end" })).not.toBeNull();
  });
  it("rejects U+0016 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(22) + "-end" })).not.toBeNull();
  });
  it("rejects U+0017 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(23) + "-end" })).not.toBeNull();
  });
  it("rejects U+0018 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(24) + "-end" })).not.toBeNull();
  });
  it("rejects U+0019 in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(25) + "-end" })).not.toBeNull();
  });
  it("rejects U+001a in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(26) + "-end" })).not.toBeNull();
  });
  it("rejects U+001b in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(27) + "-end" })).not.toBeNull();
  });
  it("rejects U+001c in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(28) + "-end" })).not.toBeNull();
  });
  it("rejects U+001d in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(29) + "-end" })).not.toBeNull();
  });
  it("rejects U+001e in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(30) + "-end" })).not.toBeNull();
  });
  it("rejects U+001f in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(31) + "-end" })).not.toBeNull();
  });
  it("rejects U+007f in agentId", () => {
    expect(validateAgentCheckpoint({ ...valid, agentId: "part" + String.fromCharCode(127) + "-end" })).not.toBeNull();
  });
  it("rejects U+0000 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(0) + "-end" })).not.toBeNull();
  });
  it("rejects U+0001 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(1) + "-end" })).not.toBeNull();
  });
  it("rejects U+0002 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(2) + "-end" })).not.toBeNull();
  });
  it("rejects U+0003 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(3) + "-end" })).not.toBeNull();
  });
  it("rejects U+0004 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(4) + "-end" })).not.toBeNull();
  });
  it("rejects U+0005 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(5) + "-end" })).not.toBeNull();
  });
  it("rejects U+0006 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(6) + "-end" })).not.toBeNull();
  });
  it("rejects U+0007 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(7) + "-end" })).not.toBeNull();
  });
  it("rejects U+0008 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(8) + "-end" })).not.toBeNull();
  });
  it("rejects U+0009 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(9) + "-end" })).not.toBeNull();
  });
  it("rejects U+000a in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(10) + "-end" })).not.toBeNull();
  });
  it("rejects U+000b in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(11) + "-end" })).not.toBeNull();
  });
  it("rejects U+000c in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(12) + "-end" })).not.toBeNull();
  });
  it("rejects U+000d in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(13) + "-end" })).not.toBeNull();
  });
  it("rejects U+000e in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(14) + "-end" })).not.toBeNull();
  });
  it("rejects U+000f in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(15) + "-end" })).not.toBeNull();
  });
  it("rejects U+0010 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(16) + "-end" })).not.toBeNull();
  });
  it("rejects U+0011 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(17) + "-end" })).not.toBeNull();
  });
  it("rejects U+0012 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(18) + "-end" })).not.toBeNull();
  });
  it("rejects U+0013 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(19) + "-end" })).not.toBeNull();
  });
  it("rejects U+0014 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(20) + "-end" })).not.toBeNull();
  });
  it("rejects U+0015 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(21) + "-end" })).not.toBeNull();
  });
  it("rejects U+0016 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(22) + "-end" })).not.toBeNull();
  });
  it("rejects U+0017 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(23) + "-end" })).not.toBeNull();
  });
  it("rejects U+0018 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(24) + "-end" })).not.toBeNull();
  });
  it("rejects U+0019 in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(25) + "-end" })).not.toBeNull();
  });
  it("rejects U+001a in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(26) + "-end" })).not.toBeNull();
  });
  it("rejects U+001b in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(27) + "-end" })).not.toBeNull();
  });
  it("rejects U+001c in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(28) + "-end" })).not.toBeNull();
  });
  it("rejects U+001d in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(29) + "-end" })).not.toBeNull();
  });
  it("rejects U+001e in threadId", () => {
    expect(validateAgentCheckpoint({ ...valid, threadId: "part" + String.fromCharCode(30) + "-end" })).not.toBeNull();
  });
});
