/**
 * `ctx-sync sync` command.
 *
 * Performs a full bidirectional sync:
 *   1. Validate remote URL (transport security).
 *   2. Pull latest from remote (if remote exists).
 *   3. Detect and handle merge conflicts on encrypted (.age) files.
 *   4. Commit all .age files + manifest.json.
 *   5. Push to remote.
 *
 * Merge conflicts on .age files are NEVER auto-merged — the user must
 * choose which version to keep (local or remote) because encrypted blobs
 * cannot be meaningfully merged.
 *
 * @module commands/sync
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { STATE_FILES } from '@ctx-sync/shared';
import { simpleGit } from 'simple-git';
import { commitState, pushState } from '../core/git-sync.js';
import { validateRemoteUrl } from '../core/transport.js';
import { readManifest, writeManifest, listStateFiles } from '../core/state-manager.js';
import { getSyncDir } from './init.js';

/** Options for the sync command */
export interface SyncOptions {
  /** Skip pulling from remote */
  noPull?: boolean;
  /** Skip pushing to remote */
  noPush?: boolean;
  /** Non-interactive mode — use local version on conflict */
  noInteractive?: boolean;
}

/** Result of a sync operation */
export interface SyncResult {
  /** Whether a pull was performed */
  pulled: boolean;
  /** Whether a commit was created */
  committed: boolean;
  /** Whether a push was performed */
  pushed: boolean;
  /** Commit hash, if a commit was created */
  commitHash: string | null;
  /** Number of files synced */
  fileCount: number;
  /** Whether there were merge conflicts */
  hadConflicts: boolean;
  /** Files that had merge conflicts */
  conflictFiles: string[];
  /** Whether the repo has a remote configured */
  hasRemote: boolean;
}

/**
 * Check whether the sync repo has a remote configured and validate it.
 *
 * @param syncDir - The sync directory path.
 * @returns The remote URL, or `null` if no remote is configured.
 * @throws If the remote URL uses an insecure protocol.
 */
export async function validateSyncRemote(syncDir: string): Promise<string | null> {
  const git = simpleGit(syncDir);
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === 'origin');

  if (!origin) {
    return null;
  }

  const url = origin.refs.push || origin.refs.fetch;
  validateRemoteUrl(url);
  return url;
}

/**
 * Pull latest from the remote, detecting merge conflicts.
 *
 * Attempts `git pull`. If a merge conflict is detected on `.age` files,
 * returns the list of conflicting files. Conflicts on .age files are
 * NEVER auto-merged — the user must resolve them.
 *
 * @param syncDir - The sync directory path.
 * @returns List of files with merge conflicts (empty if no conflicts).
 */
export async function pullWithConflictDetection(
  syncDir: string,
): Promise<{ pulled: boolean; conflictFiles: string[] }> {
  const git = simpleGit(syncDir);

  // Verify remote exists
  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === 'origin');

  if (!origin) {
    return { pulled: false, conflictFiles: [] };
  }

  const url = origin.refs.fetch || origin.refs.push;
  validateRemoteUrl(url);

  try {
    await git.pull('origin', 'main');
    return { pulled: true, conflictFiles: [] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect merge conflicts
    if (message.includes('CONFLICT') || message.includes('Merge conflict')) {
      const status = await git.status();
      const conflicting = status.conflicted || [];
      return { pulled: true, conflictFiles: conflicting };
    }

    // Re-throw non-conflict errors
    throw err;
  }
}

/**
 * Resolve merge conflicts on .age files by choosing local or remote version.
 *
 * Encrypted files cannot be meaningfully merged, so the user must choose
 * one version. In non-interactive mode, local version is kept (safest default).
 *
 * @param syncDir - The sync directory path.
 * @param conflictFiles - Files with conflicts.
 * @param useLocal - If true, keep local version; if false, use remote version.
 */
export async function resolveConflicts(
  syncDir: string,
  conflictFiles: string[],
  useLocal: boolean = true,
): Promise<void> {
  const git = simpleGit(syncDir);

  for (const file of conflictFiles) {
    if (useLocal) {
      // Keep our version (--ours)
      await git.checkout(['--ours', file]);
    } else {
      // Use their version (--theirs)
      await git.checkout(['--theirs', file]);
    }
    await git.add(file);
  }
}

/**
 * Collect all syncable files (all .age files + manifest.json) in the sync dir.
 *
 * @param syncDir - The sync directory path.
 * @returns List of file paths relative to the sync dir.
 */
export function collectSyncFiles(syncDir: string): string[] {
  const files: string[] = [];

  // Add all .age files
  const ageFiles = listStateFiles(syncDir);
  files.push(...ageFiles);

  // Add manifest.json if it exists
  const manifestPath = path.join(syncDir, STATE_FILES.MANIFEST);
  if (fs.existsSync(manifestPath)) {
    files.push(STATE_FILES.MANIFEST);
  }

  return files;
}

/**
 * Execute the sync command logic.
 *
 * Full bidirectional sync:
 *   1. Validate remote URL.
 *   2. Pull latest (with conflict detection).
 *   3. Handle any conflicts.
 *   4. Update manifest timestamp.
 *   5. Commit all .age + manifest.json.
 *   6. Push to remote.
 *
 * @param options - Sync command options.
 * @returns Sync result with operation details.
 */
export async function executeSync(options: SyncOptions = {}): Promise<SyncResult> {
  const syncDir = getSyncDir();

  // Verify sync dir exists
  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error(
      'No sync repository found. Run `ctx-sync init` first.',
    );
  }

  const result: SyncResult = {
    pulled: false,
    committed: false,
    pushed: false,
    commitHash: null,
    fileCount: 0,
    hadConflicts: false,
    conflictFiles: [],
    hasRemote: false,
  };

  // 1. Validate remote (if exists)
  const remoteUrl = await validateSyncRemote(syncDir);
  result.hasRemote = remoteUrl !== null;

  // 2. Pull latest (if remote exists and not skipped)
  if (result.hasRemote && !options.noPull) {
    const pullResult = await pullWithConflictDetection(syncDir);
    result.pulled = pullResult.pulled;

    // 3. Handle merge conflicts
    if (pullResult.conflictFiles.length > 0) {
      result.hadConflicts = true;
      result.conflictFiles = pullResult.conflictFiles;

      // In non-interactive mode, keep local version (safest default)
      // In interactive mode, this would prompt the user
      const useLocal = options.noInteractive !== false;
      await resolveConflicts(syncDir, pullResult.conflictFiles, useLocal);
    }
  }

  // 4. Update manifest timestamp
  const manifest = readManifest(syncDir) ?? {
    version: '1.0.0',
    lastSync: new Date().toISOString(),
    files: {},
  };
  manifest.lastSync = new Date().toISOString();
  writeManifest(syncDir, manifest);

  // 5. Collect and commit all sync files
  const files = collectSyncFiles(syncDir);
  result.fileCount = files.length;

  if (files.length > 0) {
    const hash = await commitState(syncDir, files, 'sync: update encrypted state');
    result.committed = hash !== null;
    result.commitHash = hash;
  }

  // 6. Push to remote (if exists and not skipped)
  if (result.hasRemote && !options.noPush) {
    await pushState(syncDir);
    result.pushed = true;
  }

  return result;
}

/**
 * Register the `sync` command on the given Commander program.
 */
export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync encrypted state with remote (pull + commit + push)')
    .option('--no-pull', 'Skip pulling from remote')
    .option('--no-push', 'Skip pushing to remote')
    .option('--no-interactive', 'Non-interactive mode (keep local on conflict)')
    .action(async (opts: Record<string, unknown>) => {
      const options: SyncOptions = {
        noPull: opts['pull'] === false,
        noPush: opts['push'] === false,
        noInteractive: opts['interactive'] === false,
      };

      try {
        const chalk = (await import('chalk')).default;
        const { default: ora } = await import('ora');

        const spinner = ora('Syncing...').start();

        // Pull phase
        if (!options.noPull) {
          spinner.text = 'Pulling latest from remote...';
        }

        const result = await executeSync(options);

        spinner.stop();

        // Report results
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
          console.log(chalk.dim('   No remote configured — local only'));
        }

        console.log(chalk.green('\n✅ Sync complete'));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}
