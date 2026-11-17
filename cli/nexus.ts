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

const help = `NEXUS AU — terminal assistant (early development)

Usage: nexus [--help | --version]

  --help       Show this help
  --version    Show version

Interactive commands: /help, /agent <task>, /exit
A model is not configured yet. No files or commands are accessed.
`;
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && ['--help', '-h', '--version', '-v'].includes(args[0]))) {
  stderr.write(`Unknown option: ${args[0]}\n`);
  process.exitCode = 2;
} else if (args.includes('--help') || args.includes('-h')) {
  stdout.write(help);
} else if (args.includes('--version') || args.includes('-v')) {
  stdout.write(`${pkg.version}\n`);
} else if (!stdin.isTTY || !stdout.isTTY) {
  stderr.write('Model is not configured; noninteractive requests are unavailable.\n');
  process.exitCode = 1;
} else {
  const router = new ModelRouter();
  const session = new TerminalSession(router, 'unconfigured', 'unconfigured');
  const terminal = createInterface({ input: stdin, output: stdout });
  const permissions = new TerminalPermissions(prompt => terminal.question(prompt));
  // Fail closed until a durable audit store and native tools are available.
  const audit = { record: async () => err('storage_failed', 'Durable audit is unavailable.') };
  const gateway = new ToolGateway(permissions, audit, { now: () => Date.now() });
  const registry = new ToolRegistry(gateway);
  const agent = new TerminalAgent(new AgentPlanner(new ModelRouterPlanner(router, 'unconfigured', 'unconfigured')), registry, new GatewayAgentToolExecutor(gateway, 'owner'));
  const controller = new AbortController();
  terminal.on('SIGINT', () => { controller.abort(); terminal.close(); });
  stdout.write('NEXUS AU · terminal preview\nType /help for commands.\n');
  try {
    while (true) {
      let line;
      try { line = (await terminal.question('❯ ')).trim(); } catch { break; }
      if (line === '/exit' || line === '/quit') break;
      if (line === '/help') stdout.write(help);
      else if (await dispatchCommand(line, { run: agent.run.bind(agent), write: text => stdout.write(text), newId: randomUUID, signal: controller.signal })) continue;
      else if (line) await runPrompt(session, line, text => stdout.write(text), () => stderr.write('Model is not configured. Provider integration is pending.\n')); 
    }
  } finally { terminal.close(); }
}
