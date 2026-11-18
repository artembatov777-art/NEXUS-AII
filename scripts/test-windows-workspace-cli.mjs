// Native smoke for the CLI command dispatcher, using the actual .exe host.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

assert.equal(process.platform, 'win32', 'This smoke requires native Windows.');
const sha = value => createHash('sha256').update(value).digest('hex');
const temp = await mkdtemp(join(tmpdir(), 'nexus-windows-cli-'));
const previousHome = process.env.USERPROFILE;
let session;
try {
  process.env.USERPROFILE = temp;
  const bin = join(temp, 'bin');
  const root = join(temp, 'workspace project');
  await mkdir(bin);
  await mkdir(root);
  await copyFile(resolve('build-cli/bin/nexus-workspace.exe'), join(bin, 'nexus-workspace.exe'));
  const bundle = join(temp, 'workspace.mjs');
  await build({ entryPoints: ['cli/workspaceHost.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm' });
  const { workspaceSession } = await import(pathToFileURL(bundle).href);
  const permissions = [];
  session = workspaceSession({ authorize: async request => {
    permissions.push(request.scope);
    return 'allow';
  } }, () => {});
  const command = line => session.command(line, new AbortController().signal);

  const first = join(root, 'first.txt');
  const second = join(root, 'second.txt');
  await writeFile(first, 'old first');
  await writeFile(second, 'old second');
  assert.match(await command(`/project ${root}`), /Selected/);
  const original = JSON.parse(await command('/read first.txt'));
  const untouched = JSON.parse(await command('/read second.txt'));
  assert.match(original.revision, /^win:/);
  assert.match(await command('/agent status'), /Workspace host: connected \(read-only\)/);
  const run = (goal, signal = new AbortController().signal) => session.run(goal, randomUUID(), signal);
  for (const [goal, expected] of [
    ['list', 'first.txt'],
    ['read first.txt', 'old first'],
    ['search old first', 'first.txt']
  ]) {
    const result = await run(goal);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(JSON.stringify(result.value).includes(expected));
  }
  assert.equal((await run('read first.txt', AbortSignal.abort())).error.code, 'cancelled');

  const draft = JSON.stringify({ path: 'first.txt', from: 'old first', to: 'new first' });
  const planInput = JSON.stringify({ goal: 'review fixture', changes: [JSON.parse(draft)] });
  assert.match(await command(`/agent plan ${planInput}`), /Agent plan/);
  assert.match(await command('/agent diff'), /new first/);
  assert.match(await command(`/draft ${draft}`), /Use \/approve/);
  assert.match(await command('/approve'), /Draft approved/);
  permissions.length = 0;
  assert.match(await command('/apply'), /cannot apply drafts/);
  assert.deepEqual(permissions, []);
  assert.equal(await readFile(first, 'utf8'), 'old first');
  assert.match(await command('/approve'), /Prepare an unapproved draft first/);

  // Seed real native revisions with one confirmed edit and an interrupted
  // dispatch. The shipped CLI must inspect them but still refuse rollback.
  await writeFile(first, 'new first');
  const published = JSON.parse(await command('/read first.txt'));
  const id = randomUUID();
  const manifest = {
    root, plan: sha('fixture plan'),
    files: [
      { path: 'first.txt', revision: original.revision, before: sha(original.content), after: sha(published.content) },
      { path: 'second.txt', revision: untouched.revision, before: sha(untouched.content), after: sha('new second') }
    ]
  };
  const recoveryHash = sha('fixture payload');
  const dir = join(temp, '.nexus-au', 'workspace-audit');
  const intent = join(dir, id + '.edit.json');
  await writeFile(intent, JSON.stringify({ version: 4, ...manifest, recoveryHash, intentHash: sha(JSON.stringify({ id, manifest, recoveryHash })) }));
  const steps = [
    { phase: 'preflight-started' },
    { phase: 'preflight-passed' },
    { phase: 'dispatch-intent', path: 'first.txt' },
    { phase: 'applied', path: 'first.txt', revision: published.revision },
    { phase: 'dispatch-intent', path: 'second.txt' }
  ];
  const journal = steps.map(step =>
    JSON.stringify({ ...step, checksum: sha(JSON.stringify({ runId: id, step })) })
  ).join('\n') + '\n';
  await writeFile(intent + '.steps', journal);
  const recovered = await command(`/recover ${id}`);
  assert.match(recovered, /first\.txt" \(journal: confirmed revision\)/);
  assert.match(recovered, /second\.txt" \(journal: dispatch recorded; outcome unconfirmed\)/);
  await writeFile(intent + '.steps', journal.replace('dispatch-intent', 'edited-step'));
  assert.match(await command(`/recover ${id}`), /first\.txt" \(journal: write evidence unavailable\)/);
  await writeFile(intent + '.steps', journal);

  await rename(first, join(root, 'old-identity.txt'));
  await writeFile(first, 'new first');
  assert.match(await command(`/recover ${id}`), /first\.txt" \(journal: confirmed revision has since changed\)/);
  assert.match(await command(`/rollback ${id}`), /cannot apply rollbacks/);
  assert.equal(await readFile(first, 'utf8'), 'new first');
  assert.equal(await readFile(second, 'utf8'), 'old second');
} finally {
  session?.close();
  if (previousHome === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousHome;
  await rm(temp, { recursive: true, force: true, maxRetries: 8 });
}
