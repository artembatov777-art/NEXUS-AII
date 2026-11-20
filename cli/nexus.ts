#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { err } from '../src/core/result';
import { TerminalPermissions } from './permissions';
import { dispatchCommand } from './commands';
import { renderAuditCommand } from './auditView';
import { FileWorkspaceAuditSink } from './workspaceAudit';
import { stdin, stdout, stderr } from 'node:process';
import { ModelRouter } from '../src/core/model';
import { TerminalSession } from './session';
import { runPrompt } from './runner';
import pkg from '../package.json';
import { testModel } from './testModel';
import { loadHistory, saveHistory } from './history';
import { workspaceSession } from './workspaceHost';
import { join } from 'node:path';
import { homedir } from 'node:os';

const help = `NEXUS AU — terminal assistant (early development)

Usage: nexus [--help | --version | --test-model [--history PATH]]

  --help       Show this help
  --version    Show version
  --test-model Use deterministic offline echo fixture (not AI)
  --history    History file for test mode (local, not encrypted)

Interactive commands: /help, /history, /history last N, /history find TEXT, /audit recent, /audit locks, /audit <run-id>, /audit <run-id> last N, /agent <task>, /project, /files, /read, /search, /draft, /approve, /apply, /recover, /rollback, /discard, /exit
Use /project <absolute directory> to grant a project for this session.
Workspace planner: /agent plan <task>, /agent inspect, /agent diff, /agent status.
The workspace planner runs locally and requires explicit replacements for changes.
In interactive test mode: /agent read <file>, /agent list [directory], /agent search <text>.
History commands in --test-model inspect completed turns locally, without model calls.
Audit commands inspect locally saved workspace tool receipts without executing actions.
A model is not configured yet.
`;
const args = process.argv.slice(2);
const testMode = args[0] === '--test-model' && (args.length === 1 || (args.length === 3 && args[1] === '--history' && !!args[2]));
if (args.length && !testMode && !(args.length === 1 && ['--help', '-h', '--version', '-v'].includes(args[0]))) {
  stderr.write(`Unknown option: ${args[0]}\n`);
  process.exitCode = 2;
} else if (args.includes('--help') || args.includes('-h')) {
  stdout.write(help);
} else if (args.includes('--version') || args.includes('-v')) {
  stdout.write(`${pkg.version}\n`);
} else if (!testMode && (!stdin.isTTY || !stdout.isTTY)) {
  stderr.write('Model is not configured; noninteractive requests are unavailable.\n');
  process.exitCode = 1;
} else {
  const router = new ModelRouter();
  if (testMode) router.register(testModel);
  const historyPath = args[2] ?? join(homedir(), '.nexus-au', 'test-history.json');
  let history;
  try { history = testMode ? await loadHistory(historyPath) : []; }
  catch (cause) { stderr.write(`History error: ${cause instanceof Error ? cause.message : 'unable to load history'}\n`); process.exit(1); }
  const session = new TerminalSession(router, testMode ? 'test' : 'unconfigured', testMode ? 'echo' : 'unconfigured', history, testMode ? messages => saveHistory(historyPath, messages) : undefined);
  const terminal = createInterface({ input: stdin, output: stdout });
  const permissions = new TerminalPermissions(prompt => terminal.question(prompt));
  const workspace = stdin.isTTY && stdout.isTTY ? workspaceSession(permissions, text => stdout.write(text)) : undefined;
  const run = testMode && workspace ? workspace.run : async () => err('provider_unavailable', 'Offline planner requires an interactive --test-model session.');
  const controller = new AbortController();
  terminal.on('SIGINT', () => { controller.abort(); terminal.close(); });
  const auditSink = new FileWorkspaceAuditSink(join(homedir(), '.nexus-au', 'workspace-audit'));
  const commandContext = {
    workspace: workspace?.command, run,
    audit: async (line: string) => await renderAuditCommand(line, auditSink) ?? 'Usage: /audit <run-id> [last <1-50>]\n',
    history: testMode ? () => session.history() : undefined,
    write: (text: string) => stdout.write(text),
    newId: randomUUID, signal: controller.signal
  };
  if (stdin.isTTY) stdout.write(`NEXUS AU · terminal preview${testMode ? ' · TEST MODEL (offline echo, not AI)' : ''}\nType /help for commands.\n`);
  try {
    if (!stdin.isTTY && testMode) {
      for await (const line of terminal) {
        if (!line.trim()) continue;
        if (await dispatchCommand(line.trim(), commandContext)) continue;
        if (await runPrompt(session, line, text => stdout.write(text), text => stderr.write(text), controller.signal)) process.exitCode = 1;
      }
    } else while (true) {
      let line;
      try { line = (await terminal.question('❯ ')).trim(); } catch { break; }
      if (line === '/exit' || line === '/quit') break;
      if (line === '/help') stdout.write(help);
      else if (await dispatchCommand(line, commandContext)) continue;
      else if (line) await runPrompt(session, line, text => stdout.write(text), text => stderr.write(text), controller.signal);
    }
  } finally { workspace?.close(); terminal.close(); }
}
