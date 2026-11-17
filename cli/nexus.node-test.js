import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

const run = (...args) => spawnSync(process.execPath, ['build-cli/nexus.js', ...args], { encoding: 'utf8', input: '' });
test('help describes terminal usage', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: nexus/);
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
