#!/usr/bin/env node

/**
 * ctx-sync — Sync your complete development context across machines.
 *
 * CLI entry point. Uses Commander.js for command parsing and routing.
 *
 * @module ctx-sync
 */

import { createRequire } from 'node:module';
import { Command } from 'commander';
import { formatError } from './utils/errors.js';

const require = createRequire(import.meta.url);
const { version: VERSION } = require('../package.json') as { version: string };
import { registerInitCommand } from './commands/init.js';
import { registerTrackCommand } from './commands/track.js';
import { registerListCommand } from './commands/list.js';
import { registerStatusCommand } from './commands/status.js';
import { registerEnvCommand } from './commands/env.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerPushCommand } from './commands/push.js';
import { registerPullCommand } from './commands/pull.js';
import { registerRestoreCommand } from './commands/restore.js';
import { registerNoteCommand } from './commands/note.js';
import { registerShowCommand } from './commands/show.js';
import { registerDockerCommand } from './commands/docker.js';
import { registerServiceCommand } from './commands/service.js';
import { registerDirCommand } from './commands/dir.js';
import { registerKeyCommand } from './commands/key.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerTeamCommand } from './commands/team.js';
import { registerConfigCommand } from './commands/config.js';

/**
 * Create and configure the root CLI program.
 *
 * @returns The configured Commander program instance.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('ctx-sync')
    .description('Sync your complete development context across machines')
    .version(VERSION, '-V, --version');

  // Register subcommands
  registerInitCommand(program);
  registerTrackCommand(program);
  registerListCommand(program);
  registerStatusCommand(program);
  registerEnvCommand(program);
  registerSyncCommand(program);
  registerPushCommand(program);
  registerPullCommand(program);
  registerRestoreCommand(program);
  registerNoteCommand(program);
  registerShowCommand(program);
  registerDockerCommand(program);
  registerServiceCommand(program);
  registerDirCommand(program);
  registerKeyCommand(program);
  registerAuditCommand(program);
  registerTeamCommand(program);
  registerConfigCommand(program);

  return program;
}

/**
 * Main entry point — parse CLI arguments and execute the matched command.
 */
export async function main(argv?: string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv ?? process.argv);
}

// Run when executed directly (not imported as a module in tests)
const arg1 = process.argv[1]?.replace(/\\/g, '/') ?? '';
const isDirectExecution =
  arg1.endsWith('/index.ts') ||
  arg1.endsWith('/index.js') ||
  arg1.endsWith('/ctx-sync') ||
  arg1.endsWith('/ctx-sync.js');

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error(formatError(err));
    process.exit(1);
  });
}
