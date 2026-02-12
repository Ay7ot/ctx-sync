/**
 * `ctx-sync list` command.
 *
 * Reads the encrypted state file, decrypts it, and lists all
 * tracked projects with key metadata (name, path, branch, last accessed).
 *
 * @module commands/list
 */

import type { Command } from 'commander';
import type { StateFile, Project } from '@ctx-sync/shared';
import { loadKey } from '../core/key-store.js';
import { readState } from '../core/state-manager.js';
import { getConfigDir, getSyncDir } from './init.js';

/** Result returned by executeList */
export interface ListResult {
  /** All tracked projects */
  projects: Project[];
}

/**
 * Execute the list command logic.
 *
 * 1. Load the private key.
 * 2. Read and decrypt state.age.
 * 3. Return the list of tracked projects.
 *
 * @returns List result with all tracked projects.
 */
export async function executeList(): Promise<ListResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();
  const privateKey = loadKey(configDir);

  const state = await readState<StateFile>(syncDir, privateKey, 'state');

  if (!state || !state.projects || state.projects.length === 0) {
    return { projects: [] };
  }

  return { projects: state.projects };
}

/**
 * Format a project entry for display.
 *
 * @param project - The project to format.
 * @param index - The index in the list (1-based for display).
 * @returns Formatted string for console output.
 */
export function formatProject(project: Project, index: number): string {
  const lines: string[] = [];
  lines.push(`  ${index}. ${project.name}`);
  lines.push(`     Path:     ${project.path}`);
  lines.push(`     Branch:   ${project.git.branch}`);

  if (project.git.hasUncommitted) {
    lines.push('     Status:   uncommitted changes');
  }

  if (project.git.stashCount > 0) {
    lines.push(`     Stashes:  ${project.git.stashCount}`);
  }

  const accessed = new Date(project.lastAccessed);
  lines.push(`     Tracked:  ${accessed.toLocaleDateString()} ${accessed.toLocaleTimeString()}`);

  return lines.join('\n');
}

/**
 * Register the `list` command on the given Commander program.
 */
export function registerListCommand(program: Command): void {
  program
    .command('list')
    .alias('ls')
    .description('List all tracked projects')
    .action(async () => {
      try {
        const result = await executeList();

        if (result.projects.length === 0) {
          console.log('No projects tracked.');
          console.log('\nTrack your first project:');
          console.log('  $ cd ~/projects/my-app');
          console.log('  $ ctx-sync track');
          return;
        }

        const chalk = (await import('chalk')).default;
        console.log(
          chalk.bold(`Tracked projects (${result.projects.length}):\n`),
        );

        for (let i = 0; i < result.projects.length; i++) {
          const project = result.projects[i];
          if (project) {
            console.log(formatProject(project, i + 1));
          }
          if (i < result.projects.length - 1) {
            console.log('');
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}
