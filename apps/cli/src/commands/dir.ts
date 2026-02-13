/**
 * `ctx-sync dir` command group.
 *
 * Manages working directory state:
 *   - `dir visit <path>` — record a directory visit.
 *   - `dir pin <path>` — pin a directory.
 *   - `dir unpin <path>` — unpin a directory.
 *   - `dir list` — list recent and pinned directories.
 *   - `dir remove <path>` — remove a directory from the recent list.
 *
 * @module commands/dir
 */

import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import { STATE_FILES } from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { loadKey } from '../core/key-store.js';
import { commitState } from '../core/git-sync.js';
import {
  visitDirectory,
  pinDirectory,
  unpinDirectory,
  removeRecentDirectory,
  getTopDirectories,
  getPinnedDirectories,
} from '../core/directories-handler.js';
import { getConfigDir, getSyncDir } from './init.js';

// ─── Core Logic ───────────────────────────────────────────────────────────

/**
 * Execute `ctx-sync dir visit <path>`.
 */
export async function executeDirVisit(
  dirPath: string,
  noSync = false,
): Promise<{ path: string }> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  await visitDirectory(syncDir, dirPath, publicKey, privateKey);

  if (!noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.DIRECTORIES, STATE_FILES.MANIFEST],
      `dir: visit ${dirPath}`,
    );
  }

  return { path: dirPath };
}

/**
 * Execute `ctx-sync dir pin <path>`.
 */
export async function executeDirPin(
  dirPath: string,
  noSync = false,
): Promise<{ path: string; alreadyPinned: boolean }> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  const pinned = await pinDirectory(syncDir, dirPath, publicKey, privateKey);

  if (pinned && !noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.DIRECTORIES, STATE_FILES.MANIFEST],
      `dir: pin ${dirPath}`,
    );
  }

  return { path: dirPath, alreadyPinned: !pinned };
}

/**
 * Execute `ctx-sync dir unpin <path>`.
 */
export async function executeDirUnpin(
  dirPath: string,
  noSync = false,
): Promise<{ path: string; wasPinned: boolean }> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  const unpinned = await unpinDirectory(syncDir, dirPath, publicKey, privateKey);

  if (unpinned && !noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.DIRECTORIES, STATE_FILES.MANIFEST],
      `dir: unpin ${dirPath}`,
    );
  }

  return { path: dirPath, wasPinned: unpinned };
}

/**
 * Execute `ctx-sync dir remove <path>`.
 */
export async function executeDirRemove(
  dirPath: string,
  noSync = false,
): Promise<{ path: string; wasRemoved: boolean }> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  const removed = await removeRecentDirectory(
    syncDir,
    dirPath,
    publicKey,
    privateKey,
  );

  if (removed && !noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.DIRECTORIES, STATE_FILES.MANIFEST],
      `dir: remove ${dirPath}`,
    );
  }

  return { path: dirPath, wasRemoved: removed };
}

/**
 * Execute `ctx-sync dir list`.
 */
export async function executeDirList(
  limit = 10,
): Promise<{
  pinned: string[];
  recent: Array<{ path: string; frequency: number; lastVisit: string }>;
}> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);

  const pinned = await getPinnedDirectories(syncDir, privateKey);
  const recent = await getTopDirectories(syncDir, privateKey, limit);

  return { pinned, recent };
}

// ─── Commander Registration ───────────────────────────────────────────────

/**
 * Register the `ctx-sync dir` command group on the given program.
 */
export function registerDirCommand(program: Command): void {
  const dirCmd = program
    .command('dir')
    .description('Manage tracked working directories');

  // ── dir visit ─────────────────────────────────────────────────────
  dirCmd
    .command('visit <path>')
    .description('Record a directory visit')
    .option('--no-sync', 'Skip committing to sync repo')
    .action(withErrorHandler(async (dirPath: string, opts: { sync: boolean }) => {
      await executeDirVisit(dirPath, !opts.sync);
      console.log(`✓ Recorded visit to ${dirPath}`);
    }));

  // ── dir pin ───────────────────────────────────────────────────────
  dirCmd
    .command('pin <path>')
    .description('Pin a directory')
    .option('--no-sync', 'Skip committing to sync repo')
    .action(withErrorHandler(async (dirPath: string, opts: { sync: boolean }) => {
      const result = await executeDirPin(dirPath, !opts.sync);
      if (result.alreadyPinned) {
        console.log(`Directory already pinned: ${result.path}`);
      } else {
        console.log(`✓ Pinned ${result.path}`);
      }
    }));

  // ── dir unpin ─────────────────────────────────────────────────────
  dirCmd
    .command('unpin <path>')
    .description('Unpin a directory')
    .option('--no-sync', 'Skip committing to sync repo')
    .action(withErrorHandler(async (dirPath: string, opts: { sync: boolean }) => {
      const result = await executeDirUnpin(dirPath, !opts.sync);
      if (result.wasPinned) {
        console.log(`✓ Unpinned ${result.path}`);
      } else {
        console.log(`Directory was not pinned: ${result.path}`);
      }
    }));

  // ── dir remove ────────────────────────────────────────────────────
  dirCmd
    .command('remove <path>')
    .description('Remove a directory from the recent list')
    .option('--no-sync', 'Skip committing to sync repo')
    .action(withErrorHandler(async (dirPath: string, opts: { sync: boolean }) => {
      const result = await executeDirRemove(dirPath, !opts.sync);
      if (result.wasRemoved) {
        console.log(`✓ Removed ${result.path} from recent directories`);
      } else {
        console.log(`Directory not found in recent list: ${result.path}`);
      }
    }));

  // ── dir list ──────────────────────────────────────────────────────
  dirCmd
    .command('list')
    .description('List recent and pinned directories')
    .option('-l, --limit <n>', 'Number of recent directories to show', '10')
    .action(withErrorHandler(async (opts: { limit: string }) => {
      const result = await executeDirList(parseInt(opts.limit, 10));

      if (result.pinned.length === 0 && result.recent.length === 0) {
        console.log('No directories tracked.');
        return;
      }

      if (result.pinned.length > 0) {
        console.log('\n📌 Pinned directories:');
        for (const p of result.pinned) {
          console.log(`  ${p}`);
        }
      }

      if (result.recent.length > 0) {
        console.log('\n📁 Recent directories:');
        for (const d of result.recent) {
          console.log(
            `  ${d.path} (visited ${String(d.frequency)}x, last: ${d.lastVisit})`,
          );
        }
      }
    }));
}
