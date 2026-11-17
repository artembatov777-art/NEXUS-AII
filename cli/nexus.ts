#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { AgentPlanner } from '../src/core/agentPlanner';
import { ModelRouterPlanner } from '../src/core/modelPlanner';
import { GatewayAgentToolExecutor } from '../src/core/agentToolBridge';
import { ToolGateway } from '../src/core/tools';
import { ToolRegistry } from '../src/core/toolRegistry';
import { err } from '../src/core/result';
import { TerminalAgent } from './agent';
import { TerminalPermissions } from './permissions';
import { dispatchCommand } from './commands';
import { stdin, stdout, stderr } from 'node:process';
import { ModelRouter } from '../src/core/model';
import { TerminalSession } from './session';
import { runPrompt } from './runner';
import pkg from '../package.json';
import { testModel } from './testModel';
import { loadHistory, saveHistory } from './history';
import { join } from 'node:path';
import { homedir } from 'node:os';

const help = `NEXUS AU — terminal assistant (early development)

Usage: nexus [--help | --version | --test-model [--history PATH]]

  --help       Show this help
  --version    Show version
  --test-model Use deterministic offline echo fixture (not AI)
  --history    History file for test mode

Interactive commands: /help, /agent <task>, /project, /files, /read, /search, /exit
Workspace backend is not available in this build.
A model is not configured yet. No files or commands are accessed.
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
  // Fail closed until a durable audit store and native tools are available.
  const audit = { record: async () => err('storage_failed', 'Durable audit is unavailable.') };
  const gateway = new ToolGateway(permissions, audit, { now: () => Date.now() });
  const registry = new ToolRegistry(gateway);
  const agent = new TerminalAgent(new AgentPlanner(new ModelRouterPlanner(router, 'unconfigured', 'unconfigured')), registry, new GatewayAgentToolExecutor(gateway, 'owner'));
  const controller = new AbortController();
  terminal.on('SIGINT', () => { controller.abort(); terminal.close(); });
  if (stdin.isTTY) stdout.write(`NEXUS AU · terminal preview${testMode ? ' · TEST MODEL (offline echo, not AI)' : ''}\nType /help for commands.\n`);
  try {
    if (!stdin.isTTY && testMode) {
      for await (const line of terminal) {
        if (!line.trim()) continue;
        if (await dispatchCommand(line.trim(), { run: agent.run.bind(agent), write: text => stdout.write(text), newId: randomUUID, signal: controller.signal })) continue;
        if (await runPrompt(session, line, text => stdout.write(text), text => stderr.write(text), controller.signal)) process.exitCode = 1;
      }
    } else while (true) {
      let line;
      try { line = (await terminal.question('❯ ')).trim(); } catch { break; }
      if (line === '/exit' || line === '/quit') break;
      if (line === '/help') stdout.write(help);
      else if (await dispatchCommand(line, { run: agent.run.bind(agent), write: text => stdout.write(text), newId: randomUUID, signal: controller.signal })) continue;
      else if (line) await runPrompt(session, line, text => stdout.write(text), text => stderr.write(text), controller.signal);
    }
  } finally { terminal.close(); }
}
