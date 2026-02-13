/**
 * `ctx-sync push` command.
 *
 * Commits all encrypted state files (.age + manifest.json) and pushes to
 * the remote. Does NOT pull first — this is a one-way push operation.
 *
 * Validates remote URL (transport security) before every push.
 *
 * @module commands/push
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import { commitState, pushState } from '../core/git-sync.js';
import { readManifest, writeManifest } from '../core/state-manager.js';
import { validateSyncRemote, collectSyncFiles } from './sync.js';
import { getSyncDir } from './init.js';

/** Result of a push operation */
export interface PushResult {
  /** Whether a commit was created */
  committed: boolean;
  /** Whether a push was performed */
  pushed: boolean;
  /** Commit hash, if a commit was created */
  commitHash: string | null;
  /** Number of files committed */
  fileCount: number;
  /** Whether the repo has a remote configured */
  hasRemote: boolean;
}

/**
 * Execute the push command logic.
 *
 * 1. Validate remote URL.
 * 2. Update manifest timestamp.
 * 3. Commit all .age files + manifest.json.
 * 4. Push to remote.
 *
 * @returns Push result with operation details.
 */
export async function executePush(): Promise<PushResult> {
  const syncDir = getSyncDir();

  // Verify sync dir exists
  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error(
      'No sync repository found. Run `ctx-sync init` first.',
    );
  }

  const result: PushResult = {
    committed: false,
    pushed: false,
    commitHash: null,
    fileCount: 0,
    hasRemote: false,
  };

  // 1. Validate remote
  const remoteUrl = await validateSyncRemote(syncDir);
  result.hasRemote = remoteUrl !== null;

  // 2. Update manifest timestamp
  const manifest = readManifest(syncDir) ?? {
    version: '1.0.0',
    lastSync: new Date().toISOString(),
    files: {},
  };
  manifest.lastSync = new Date().toISOString();
  writeManifest(syncDir, manifest);

  // 3. Collect and commit all sync files
  const files = collectSyncFiles(syncDir);
  result.fileCount = files.length;

  if (files.length > 0) {
    const hash = await commitState(syncDir, files, 'sync: push encrypted state');
    result.committed = hash !== null;
    result.commitHash = hash;
  }

  // 4. Push to remote
  if (result.hasRemote) {
    await pushState(syncDir);
    result.pushed = true;
  }

  return result;
}

/**
 * Register the `push` command on the given Commander program.
 */
export function registerPushCommand(program: Command): void {
  program
    .command('push')
    .description('Commit and push encrypted state to remote')
    .action(withErrorHandler(async () => {
      const chalk = (await import('chalk')).default;
      const { default: ora } = await import('ora');

      const spinner = ora('Pushing...').start();

      const result = await executePush();

      spinner.stop();

      if (result.committed) {
        console.log(
          chalk.green(`✅ Committed ${result.fileCount} file(s)`),
        );
      } else {
        console.log(chalk.dim('   No changes to commit'));
      }

      if (result.pushed) {
        console.log(chalk.green('✅ Pushed to remote'));
      } else if (!result.hasRemote) {
        console.log(chalk.yellow('⚠ No remote configured — committed locally only'));
      }
    }));
}
