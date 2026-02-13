/**
 * `ctx-sync pull` command.
 *
 * Pulls the latest encrypted state from the remote. Does NOT commit or
 * push — this is a one-way pull operation.
 *
 * Validates remote URL (transport security) before every pull.
 * Handles merge conflicts on .age files (never auto-merges).
 *
 * @module commands/pull
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import { listStateFiles } from '../core/state-manager.js';
import {
  validateSyncRemote,
  pullWithConflictDetection,
  resolveConflicts,
} from './sync.js';
import { getSyncDir } from './init.js';

/** Options for the pull command */
export interface PullOptions {
  /** Non-interactive mode — keep local version on conflict */
  noInteractive?: boolean;
}

/** Result of a pull operation */
export interface PullResult {
  /** Whether a pull was performed */
  pulled: boolean;
  /** Whether there were merge conflicts */
  hadConflicts: boolean;
  /** Files that had merge conflicts */
  conflictFiles: string[];
  /** Number of state files available after pull */
  stateFileCount: number;
  /** Whether the repo has a remote configured */
  hasRemote: boolean;
}

/**
 * Execute the pull command logic.
 *
 * 1. Validate remote URL.
 * 2. Pull latest from remote (with conflict detection).
 * 3. Handle merge conflicts (keep local in non-interactive mode).
 * 4. Report available state files.
 *
 * @param options - Pull command options.
 * @returns Pull result with operation details.
 */
export async function executePull(options: PullOptions = {}): Promise<PullResult> {
  const syncDir = getSyncDir();

  // Verify sync dir exists
  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error(
      'No sync repository found. Run `ctx-sync init` first.',
    );
  }

  const result: PullResult = {
    pulled: false,
    hadConflicts: false,
    conflictFiles: [],
    stateFileCount: 0,
    hasRemote: false,
  };

  // 1. Validate remote
  const remoteUrl = await validateSyncRemote(syncDir);
  result.hasRemote = remoteUrl !== null;

  if (!result.hasRemote) {
    throw new Error(
      'No remote configured. Nothing to pull.\n' +
        'Add a remote with: ctx-sync init --remote <url>',
    );
  }

  // 2. Pull latest with conflict detection
  const pullResult = await pullWithConflictDetection(syncDir);
  result.pulled = pullResult.pulled;

  // 3. Handle conflicts
  if (pullResult.conflictFiles.length > 0) {
    result.hadConflicts = true;
    result.conflictFiles = pullResult.conflictFiles;

    // In non-interactive mode, keep local version (safest default)
    const useLocal = options.noInteractive !== false;
    await resolveConflicts(syncDir, pullResult.conflictFiles, useLocal);
  }

  // 4. Count available state files
  result.stateFileCount = listStateFiles(syncDir).length;

  return result;
}

/**
 * Register the `pull` command on the given Commander program.
 */
export function registerPullCommand(program: Command): void {
  program
    .command('pull')
    .description('Pull latest encrypted state from remote')
    .option('--no-interactive', 'Non-interactive mode (keep local on conflict)')
    .action(withErrorHandler(async (opts: Record<string, unknown>) => {
      const options: PullOptions = {
        noInteractive: opts['interactive'] === false,
      };

      const chalk = (await import('chalk')).default;
      const { default: ora } = await import('ora');

      const spinner = ora('Pulling from remote...').start();

      const result = await executePull(options);

      spinner.stop();

      if (result.hadConflicts) {
        console.log(
          chalk.yellow(`⚠ Merge conflicts resolved on ${result.conflictFiles.length} file(s):`),
        );
        for (const file of result.conflictFiles) {
          console.log(chalk.yellow(`   - ${file}`));
        }
        console.log(chalk.dim('   Local version kept (encrypted files cannot be merged).'));
      }

      if (result.pulled) {
        console.log(chalk.green('✅ Pulled latest from remote'));
      }

      console.log(
        chalk.dim(`   ${result.stateFileCount} encrypted state file(s) available`),
      );
    }));
}
