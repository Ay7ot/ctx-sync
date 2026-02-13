#!/usr/bin/env node

/**
 * ctx-sync — Sync your complete development context across machines.
 *
 * CLI entry point. Uses Commander.js for command parsing and routing.
 *
 * @module ctx-sync
 */

import { Command } from 'commander';
import { VERSION } from '@ctx-sync/shared';
import { registerInitCommand } from './commands/init.js';
import { registerTrackCommand } from './commands/track.js';
import { registerListCommand } from './commands/list.js';
import { registerStatusCommand } from './commands/status.js';
import { registerEnvCommand } from './commands/env.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerPushCommand } from './commands/push.js';
import { registerPullCommand } from './commands/pull.js';

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
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('/index.ts') ||
    process.argv[1].endsWith('/index.js') ||
    process.argv[1].endsWith('ctx-sync'));

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
