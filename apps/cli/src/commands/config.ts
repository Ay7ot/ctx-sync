/**
 * `ctx-sync config` command group.
 *
 * Subcommands:
 *   - `config safe-list` — View the current safe-list (default + custom).
 *   - `config safe-list add <key>` — Add a key to the user's custom safe-list.
 *   - `config safe-list remove <key>` — Remove a key from the custom safe-list.
 *
 * The safe-list determines which env var keys MAY be stored as plaintext
 * when `--allow-plain` is used during `env import`. Everything else is
 * encrypted by default.
 *
 * Config is stored in `~/.config/ctx-sync/config.json` (local, never synced).
 *
 * @module commands/config
 */

import type { Command } from 'commander';
import { getConfigDir } from './init.js';
import {
  listSafeList,
  addToSafeList,
  removeFromSafeList,
} from '../core/config-store.js';

/**
 * Result of listing the safe-list.
 */
export interface SafeListViewResult {
  defaults: readonly string[];
  custom: string[];
  effective: string[];
}

/**
 * Execute safe-list view.
 *
 * @returns The safe-list broken down by defaults, custom, and effective.
 */
export function executeSafeListView(): SafeListViewResult {
  const configDir = getConfigDir();
  return listSafeList(configDir);
}

/**
 * Execute safe-list add.
 *
 * @param key - The env var key to add to the safe-list.
 * @returns Object with `added` flag and descriptive message.
 */
export function executeSafeListAdd(key: string): {
  added: boolean;
  message: string;
} {
  const configDir = getConfigDir();
  return addToSafeList(configDir, key);
}

/**
 * Execute safe-list remove.
 *
 * @param key - The env var key to remove from the safe-list.
 * @returns Object with `removed` flag and descriptive message.
 */
export function executeSafeListRemove(key: string): {
  removed: boolean;
  message: string;
} {
  const configDir = getConfigDir();
  return removeFromSafeList(configDir, key);
}

/**
 * Register the `config` command group on the given Commander program.
 *
 * @param program - The Commander program instance.
 */
export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage local configuration and preferences');

  // ── config safe-list ──────────────────────────────────────────────
  const safeListCmd = configCmd
    .command('safe-list')
    .description('View or manage the env var safe-list');

  // Default action: view the safe-list
  safeListCmd.action(async () => {
    try {
      const result = executeSafeListView();

      const chalk = (await import('chalk')).default;

      console.log(chalk.bold('\nEnvironment Variable Safe-List\n'));
      console.log(
        chalk.dim(
          'Keys on the safe-list MAY be stored as plaintext when --allow-plain is used.\n' +
            'Everything else is always encrypted (encrypt-by-default).\n',
        ),
      );

      console.log(chalk.cyan('Built-in defaults:'));
      for (const key of result.defaults) {
        console.log(`  ${key}`);
      }

      if (result.custom.length > 0) {
        console.log(chalk.cyan('\nCustom additions:'));
        for (const key of result.custom) {
          console.log(`  ${key}`);
        }
      } else {
        console.log(chalk.dim('\nNo custom additions.'));
      }

      console.log(
        chalk.dim(
          `\nTotal effective safe-list: ${result.effective.length} keys`,
        ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

  // ── config safe-list add <key> ────────────────────────────────────
  safeListCmd
    .command('add <key>')
    .description('Add a key to your custom safe-list')
    .action(async (key: string) => {
      try {
        const result = executeSafeListAdd(key);

        const chalk = (await import('chalk')).default;

        if (result.added) {
          console.log(chalk.green(`✅ ${result.message}`));
          console.log(
            chalk.dim(
              '   This key will be treated as plaintext-safe when --allow-plain is used.',
            ),
          );
        } else {
          console.log(chalk.yellow(`⚠️  ${result.message}`));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });

  // ── config safe-list remove <key> ─────────────────────────────────
  safeListCmd
    .command('remove <key>')
    .description('Remove a key from your custom safe-list')
    .action(async (key: string) => {
      try {
        const result = executeSafeListRemove(key);

        const chalk = (await import('chalk')).default;

        if (result.removed) {
          console.log(chalk.green(`✅ ${result.message}`));
        } else {
          console.log(chalk.yellow(`⚠️  ${result.message}`));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}
