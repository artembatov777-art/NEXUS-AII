import { describe, expect, it, vi } from 'vitest';
import { dispatchCommand } from './commands';
import { ok, err } from '../src/core/result';

describe('terminal commands', () => {
  it('routes agent goals and displays completed steps', async () => {
    const output: string[] = [];
    const run = vi.fn(async (_goal, _id, _signal, onStep) => {
      onStep({ stepId: 'read', output: { content: 'hello' } });
      return ok([{ stepId: 'read', output: { content: 'hello' } }]);
    });
    expect(await dispatchCommand('/agent inspect the project', { run, write: value => output.push(value), newId: () => 'run-1', signal: new AbortController().signal })).toBe(true);
    expect(run).toHaveBeenCalledWith('inspect the project', 'run-1', expect.anything(), expect.any(Function));
    expect(output.join('')).toContain('read');
  });
  it('reports an agent failure and leaves unrelated input for chat', async () => {
    const output: string[] = [];
    const context = { run: async () => err('permission_denied', 'Denied'), write: (value: string) => output.push(value), newId: () => 'run-1', signal: new AbortController().signal };
    expect(await dispatchCommand('/agent test', context)).toBe(true);
    expect(output.join('')).toContain('Denied');
    expect(await dispatchCommand('hello', context)).toBe(false);
  });
});

it('reports workspace backend unavailable for workspace commands without sending them to chat', async () => {
  const output: string[] = [];
  const context = { run: async () => err('tool_failed', 'unexpected'), write: (value: string) => output.push(value), newId: () => 'run', signal: new AbortController().signal };
  for (const command of ['/project /tmp', '/files', '/read secret', '/search query']) {
    expect(await dispatchCommand(command, context)).toBe(true);
  }
  expect(output.join('')).toMatch(/workspace backend.*unavailable/i);
  expect(output).toHaveLength(4);
});


it("handles local history inspection without invoking the agent or chat provider", async () => {
  const output: string[] = [];
  const run = vi.fn(async () => err("tool_failed", "must not run"));
  const history = vi.fn(() => [
    { role: "user" as const, content: "private question" },
    { role: "assistant" as const, content: "private answer" }
  ]);
  const context = {
    run, history, write: (text: string) => output.push(text),
    newId: () => "run-1", signal: new AbortController().signal
  };
  expect(await dispatchCommand("/history last 1", context)).toBe(true);
  expect(output.join("")).toContain("private answer");
  expect(history).toHaveBeenCalledOnce();
  expect(run).not.toHaveBeenCalled();
  expect(await dispatchCommand("/history find private", context)).toBe(true);
  expect(output.join("")).toContain("matching turn");
});

it("never routes unavailable or invalid history commands to a model", async () => {
  const output: string[] = [];
  const run = vi.fn(async () => err("tool_failed", "must not run"));
  const context = {
    run, write: (text: string) => output.push(text),
    newId: () => "run-1", signal: new AbortController().signal
  };
  for (const input of ["/history", "/history find private", "/history delete"]) {
    expect(await dispatchCommand(input, context)).toBe(true);
  }
  expect(output).toHaveLength(3);
  expect(output.join("")).toMatch(/history.*unavailable/i);
  expect(run).not.toHaveBeenCalled();
});


it("routes /audit to read-only journal inspection without contacting the agent", async () => {
  const output: string[] = [];
  const run = vi.fn(async () => err("tool_failed", "must not execute"));
  const audit = vi.fn(async () => "Audit run-1: 1 event\n");
  const context = {
    run, audit, write: (value: string) => output.push(value),
    newId: () => "run-1", signal: new AbortController().signal
  };
  expect(await dispatchCommand("/audit run-1", context)).toBe(true);
  expect(audit).toHaveBeenCalledExactlyOnceWith("/audit run-1");
  expect(output).toEqual(["Audit run-1: 1 event\n"]);
  expect(run).not.toHaveBeenCalled();
});

it("reports unavailable audit storage and never forwards audit commands to a model", async () => {
  const output: string[] = [];
  const run = vi.fn(async () => err("tool_failed", "must not execute"));
  const context = {
    run, write: (value: string) => output.push(value),
    newId: () => "run-1", signal: new AbortController().signal
  };
  expect(await dispatchCommand("/audit run-1", context)).toBe(true);
  expect(output.join("")).toMatch(/audit.*unavailable/i);
  expect(run).not.toHaveBeenCalled();
});


it("routes checkpoint inspection locally without contacting the model or workspace backend", async () => {
  const output: string[] = [];
  const run = vi.fn(async () => err("tool_failed", "must not execute"));
  const checkpoint = vi.fn(async (command: string) => "Checkpoint viewed: " + command + "\n");
  const context = {
    run, checkpoint, write: (value: string) => output.push(value),
    newId: () => "run", signal: new AbortController().signal
  };
  expect(await dispatchCommand("/checkpoints", context)).toBe(true);
  expect(await dispatchCommand("/checkpoint run-1", context)).toBe(true);
  expect(checkpoint).toHaveBeenNthCalledWith(1, "/checkpoints");
  expect(checkpoint).toHaveBeenNthCalledWith(2, "/checkpoint run-1");
  expect(run).not.toHaveBeenCalled();
  expect(output.join("")).toContain("Checkpoint viewed:");
});

it("blocks checkpoint commands even when the inspector is unavailable", async () => {
  const output: string[] = [];
  const run = vi.fn(async () => err("tool_failed", "must not execute"));
  const context = {
    run, write: (value: string) => output.push(value),
    newId: () => "run", signal: new AbortController().signal
  };
  expect(await dispatchCommand("/checkpoint run-1", context)).toBe(true);
  expect(await dispatchCommand("/checkpoints 5", context)).toBe(true);
  expect(output.join("")).toMatch(/checkpoint.*unavailable/i);
  expect(run).not.toHaveBeenCalled();
});
