/**
 * `ctx-sync status` command.
 *
 * Shows sync status (last sync time, pending changes, remote connectivity)
 * and per-project status (branch, uncommitted changes).
 *
 * @module commands/status
 */

import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import type { StateFile, Manifest } from '@ctx-sync/shared';
import { loadKey } from '../core/key-store.js';
import { readState, readManifest } from '../core/state-manager.js';
import { getStatus } from '../core/git-sync.js';
import { getConfigDir, getSyncDir } from './init.js';

/** Sync status information */
export interface SyncInfo {
  /** Last sync timestamp from manifest */
  lastSync: string | null;
  /** Number of pending (uncommitted) changes in the sync repo */
  pendingChanges: number;
  /** Whether the sync repo has a remote configured */
  hasRemote: boolean;
  /** Whether the sync repo is clean */
  isClean: boolean;
  /** Number of commits ahead of remote */
  ahead: number;
  /** Number of commits behind remote */
  behind: number;
}

/** Per-project status */
export interface ProjectStatus {
  name: string;
  path: string;
  branch: string;
  hasUncommitted: boolean;
  stashCount: number;
  lastAccessed: string;
}

/** Result returned by executeStatus */
export interface StatusResult {
  sync: SyncInfo;
  projects: ProjectStatus[];
}

/**
 * Execute the status command logic.
 *
 * 1. Read manifest for last sync time.
 * 2. Get sync repo status (pending changes, remote).
 * 3. Read state.age for per-project info.
 *
 * @returns Status result with sync and project info.
 */
export async function executeStatus(): Promise<StatusResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // Read manifest for last sync time
  let manifest: Manifest | null = null;
  try {
    manifest = readManifest(syncDir);
  } catch {
    // Manifest might not exist yet
  }

  // Get sync repo status
  let syncStatus = {
    files: [] as string[],
    ahead: 0,
    behind: 0,
    isClean: true,
  };
  let hasRemote = false;

  try {
    syncStatus = await getStatus(syncDir);
    // Check if remote exists by looking at the git status
    // getStatus returns ahead/behind which requires a remote
    hasRemote = syncStatus.ahead > 0 || syncStatus.behind > 0 || !syncStatus.isClean;
  } catch {
    // Sync repo might not be initialized yet
  }

  // Try to determine if remote exists by checking git remotes directly
  try {
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(syncDir);
    const remotes = await git.getRemotes();
    hasRemote = remotes.length > 0;
  } catch {
    // Can't check remotes — that's fine
  }

  const sync: SyncInfo = {
    lastSync: manifest?.lastSync ?? null,
    pendingChanges: syncStatus.files.length,
    hasRemote,
    isClean: syncStatus.isClean,
    ahead: syncStatus.ahead,
    behind: syncStatus.behind,
  };

  // Read per-project status
  const projects: ProjectStatus[] = [];
  try {
    const privateKey = loadKey(configDir);
    const state = await readState<StateFile>(syncDir, privateKey, 'state');

    if (state?.projects) {
      for (const project of state.projects) {
        projects.push({
          name: project.name,
          path: project.path,
          branch: project.git.branch,
          hasUncommitted: project.git.hasUncommitted,
          stashCount: project.git.stashCount,
          lastAccessed: project.lastAccessed,
        });
      }
    }
  } catch {
    // State file might not exist yet
  }

  return { sync, projects };
}

/**
 * Register the `status` command on the given Commander program.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show sync status and project overview')
    .action(withErrorHandler(async () => {
      const result = await executeStatus();
        const chalk = (await import('chalk')).default;

        // Sync status
        console.log(chalk.bold('Sync Status:\n'));

        if (result.sync.lastSync) {
          const syncDate = new Date(result.sync.lastSync);
          console.log(
            `  Last sync:  ${syncDate.toLocaleDateString()} ${syncDate.toLocaleTimeString()}`,
          );
        } else {
          console.log('  Last sync:  never');
        }

        if (result.sync.isClean) {
          console.log(chalk.green('  State:      up to date'));
        } else {
          console.log(
            chalk.yellow(
              `  State:      ${result.sync.pendingChanges} pending change(s)`,
            ),
          );
        }

        if (result.sync.hasRemote) {
          console.log(chalk.green('  Remote:     connected'));
          if (result.sync.ahead > 0) {
            console.log(chalk.yellow(`  Ahead:      ${result.sync.ahead} commit(s)`));
          }
          if (result.sync.behind > 0) {
            console.log(chalk.yellow(`  Behind:     ${result.sync.behind} commit(s)`));
          }
        } else {
          console.log(chalk.dim('  Remote:     not configured'));
        }

        // Project status
        if (result.projects.length === 0) {
          console.log(chalk.dim('\nNo projects tracked.'));
          return;
        }

        console.log(
          chalk.bold(`\nProjects (${result.projects.length}):\n`),
        );

        for (const project of result.projects) {
          const statusIcon = project.hasUncommitted
            ? chalk.yellow('●')
            : chalk.green('●');

          console.log(`  ${statusIcon} ${project.name}`);
          console.log(`    Branch: ${project.branch}`);

          if (project.hasUncommitted) {
            console.log(chalk.yellow('    Uncommitted changes'));
          }

          if (project.stashCount > 0) {
            console.log(chalk.yellow(`    ${project.stashCount} stash(es)`));
          }
        }
    }));
}
