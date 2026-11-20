import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

const run = (...args) => spawnSync(process.execPath, ['build-cli/nexus.js', ...args], { encoding: 'utf8', input: '' });
test('help describes terminal usage', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: nexus/);
  assert.match(result.stdout, /\/agent plan <task>.*\/agent inspect.*\/agent diff.*\/agent status/);
  assert.match(result.stdout, /\/git status.*\/git diff.*\/git diff staged.*\/git log/);
});
test('unknown arguments fail without starting a session', () => {
  const result = run('--unknown');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option/);
});
test('noninteractive input reports unavailable model honestly', () => {
  const result = spawnSync(process.execPath, ['build-cli/nexus.js'], { encoding: 'utf8', input: 'hello\n' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /model.*not configured/i);
});

test('test model streams and restores completed turns across processes', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const history = join(mkdtempSync(join(tmpdir(), 'nexus-history-')), 'history.json');
  const runTest = input => spawnSync(process.execPath, ['build-cli/nexus.js', '--test-model', '--history', history], { encoding: 'utf8', input });
  const first = runTest('hello\n');
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /TEST MODEL.*hello/s);
  const second = runTest('again\n');
  assert.equal(second.status, 0, second.stderr);
  const saved = JSON.parse(readFileSync(history, 'utf8'));
  assert.deepEqual(saved.messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(saved.messages[0].content, 'hello');
});

test('corrupt history fails without overwriting it', async () => {
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const history = join(mkdtempSync(join(tmpdir(), 'nexus-history-')), 'history.json');
  writeFileSync(history, 'broken');
  const result = spawnSync(process.execPath, ['build-cli/nexus.js', '--test-model', '--history', history], { encoding: 'utf8', input: 'hello\n' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /History error/);
  assert.equal(readFileSync(history, 'utf8'), 'broken');
});

test('workspace commands in test mode report unavailable rather than being sent to the fixture', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const history = join(mkdtempSync(join(tmpdir(), 'nexus-workspace-')), 'history.json');
  const result = spawnSync(process.execPath, ['build-cli/nexus.js', '--test-model', '--history', history], { encoding: 'utf8', input: '/files\n/agent plan fixture\n/agent inspect\n/agent diff\n/agent status\n' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.match(/workspace backend.*unavailable/gi)?.length, 5);
  assert.doesNotMatch(result.stdout, /TEST MODEL/);
});


test('history commands inspect saved test turns without sending prompts or writing history', async () => {
  const { mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const history = join(mkdtempSync(join(tmpdir(), 'nexus-history-view-')), 'history.json');
  const fixture = input => spawnSync(process.execPath, ['build-cli/nexus.js', '--test-model', '--history', history], { encoding: 'utf8', input });
  const first = fixture('hello world\n');
  assert.equal(first.status, 0, first.stderr);
  const before = readFileSync(history, 'utf8');

  const inspected = fixture('/history\n/history last 1\n/history find HELLO\n');
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.match(inspected.stdout, /History: 1 completed turns/);
  assert.match(inspected.stdout, /Turn 1/);
  assert.match(inspected.stdout, /History search.*1 matching turn/);
  assert.match(inspected.stdout, /hello world/);
  // History includes a previously persisted echo answer, so TEST MODEL text is expected.
  // A command must never be echoed as a fresh model prompt.
  assert.doesNotMatch(inspected.stdout, /\[TEST MODEL\]\s*\/(?:history|audit)\b/);
  assert.equal(readFileSync(history, 'utf8'), before, 'inspection must not modify persisted turns');
});

test('history is not silently forwarded to the model in unconfigured terminal mode', async () => {
  const output = run('--help');
  assert.equal(output.status, 0);
  assert.match(output.stdout, /\/history/);
});


test('audit lookup remains local without a model or workspace backend', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'nexus-audit-view-'));
  const history = join(home, 'test-history.json');
  const result = spawnSync(process.execPath,
    ['build-cli/nexus.js', '--test-model', '--history', history],
    { encoding: 'utf8', env: { ...process.env, HOME: home }, input: '/audit recent\n/audit locks\n/audit status run-audit-smoke\n/audit run-audit-smoke\n' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No audit runs found/);
  assert.match(result.stdout, /No audit writer locks found/);
  assert.match(result.stdout, /No audit events for/);
  assert.doesNotMatch(result.stdout, /TEST MODEL/);
});


test("checkpoint commands inspect a persisted CLI plan without model requests or replay", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'nexus-cli-checkpoint-'));
  const folder = join(home, '.nexus-au', 'agent-checkpoints');
  const history = join(home, 'test-history.json');
  const record = join(folder, 'run-inspected.json');
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const checkpoint = {
      schemaVersion: 1, runId: 'run-inspected', agentId: 'nexus.cli.workspace',
      threadId: 'workspace-cli', sequence: 2, status: 'running',
      state: {
        kind: 'nexus.plan-run.v1',
        steps: [{ id: 'read', toolId: 'cli.workspace.read' }],
        nextStep: 0, active: { index: 0, id: 'read', toolId: 'cli.workspace.read' }
      },
      createdAt: 100, updatedAt: 200
    };
    writeFileSync(record, JSON.stringify(checkpoint), { mode: 0o600 });
    const before = readFileSync(record, 'utf8');
    const env = process.platform === 'win32'
      ? { ...process.env, USERPROFILE: home }
      : { ...process.env, HOME: home };
    const result = spawnSync(process.execPath,
      ['build-cli/nexus.js', '--test-model', '--history', history],
      { encoding: 'utf8', env, input: '/checkpoints\n/checkpoint run-inspected\n/recovery run-inspected\n' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Saved CLI plan checkpoints/);
    assert.match(result.stdout, /cli\.workspace\.read/);
    assert.match(result.stdout, /unconfirmed/);
    assert.match(result.stdout, /audit status run-inspected/);
    assert.match(result.stdout, /Recovery inspection/);
    assert.match(result.stdout, /Automatic recovery and tool replay are disabled/);
    assert.doesNotMatch(result.stdout, /\[TEST MODEL\]/);
    assert.equal(readFileSync(record, 'utf8'), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});


test("Git commands without a selected project stay local and are never sent to the test model", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const home = mkdtempSync(join(tmpdir(), "nexus-git-cli-gate-"));
  try {
    const history = join(home, "test-history.json");
    const result = spawnSync(process.execPath, ["build-cli/nexus.js", "--test-model", "--history", history],
      { encoding: "utf8", input: "/git status\n/git diff\n/git log\n" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.match(/workspace backend.*unavailable/gi)?.length, 3);
    assert.doesNotMatch(result.stdout, /TEST MODEL/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
