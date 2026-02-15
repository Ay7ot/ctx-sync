/**
 * `ctx-sync restore <project>` command.
 *
 * Decrypts all state files and restores a project's context on a new
 * (or existing) machine:
 *   1. Decrypt state.age → find the project entry.
 *   2. Resolve local project path (cross-machine path resolution via `--path`).
 *   3. Display project info (directory, branch, env var count).
 *   4. Display mental context (if available).
 *   5. Collect commands to execute (Docker services, auto-start services).
 *   6. Present commands for user approval (MANDATORY — no bypass).
 *   7. Execute approved commands.
 *   8. Set up env vars (.env file) in the project directory.
 *   9. Checkout correct git branch (if repo exists locally).
 *
 * **Cross-machine support:** When the stored `project.path` does not exist
 * on the current machine (common when restoring on a different OS or file
 * layout), the `--path <dir>` flag allows overriding the project directory.
 * Without the flag, restore falls back to `process.cwd()` with a warning.
 *
 * **Security:** Commands are NEVER auto-executed. There is no `--yes` or
 * `--no-confirm` flag. In `--no-interactive` mode, commands are displayed
 * but not executed.
 *
 * @module commands/restore
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import type {
  StateFile,
  Project,
  EnvVars,
  DockerState,
  MentalContext,
  ServiceState,
  ProjectMentalContext,
} from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { loadKey } from '../core/key-store.js';
import { readState } from '../core/state-manager.js';
import {
  formatCommandsForDisplay,
  presentCommandsForApproval,
} from '../core/command-validator.js';
import type { PendingCommand, ApprovalResult } from '../core/command-validator.js';
import { getConfigDir, getSyncDir } from './init.js';
import { withErrorHandler } from '../utils/errors.js';

/** Options for the restore command */
export interface RestoreOptions {
  /** Non-interactive mode: display commands but skip execution */
  noInteractive?: boolean;
  /** Skip pulling from remote before restoring */
  noPull?: boolean;
  /** Explicit local path override for the project directory (cross-machine support) */
  localPath?: string;
  /** Override for the prompt function (for testing) */
  promptFn?: (commands: PendingCommand[]) => Promise<'all' | 'none' | 'select'>;
  /** Override for the select function (for testing) */
  selectFn?: (cmd: PendingCommand, index: number) => Promise<boolean>;
}

/** Result of a restore operation */
export interface RestoreResult {
  /** The project that was restored */
  project: Project;
  /** Whether we pulled from remote before restoring */
  pulled: boolean;
  /** Number of env vars available for the project */
  envVarCount: number;
  /** Whether env vars were written to a .env file */
  envFileWritten: boolean;
  /** Whether the git branch was checked out */
  branchCheckedOut: boolean;
  /** Mental context for the project (if available) */
  mentalContext: ProjectMentalContext | null;
  /** Commands that were presented for approval */
  commandsPresented: PendingCommand[];
  /** Approval result */
  approval: ApprovalResult;
  /** Commands that were executed */
  executedCommands: string[];
  /** Commands that failed */
  failedCommands: Array<{ command: string; error: string }>;
  /** The resolved local path used for this restore (may differ from project.path) */
  localPath: string;
  /** Whether the path was resolved differently from the stored project.path */
  pathResolved: boolean;
}

/**
 * Collect all commands that need to be executed for a project restore.
 *
 * Gathers Docker service commands and auto-start service commands from
 * the encrypted state files.
 *
 * @param projectName - The name of the project to restore.
 * @param syncDir - The sync directory path.
 * @param privateKey - The Age private key for decryption.
 * @returns List of pending commands for approval.
 */
export async function collectRestoreCommands(
  projectName: string,
  syncDir: string,
  privateKey: string,
): Promise<PendingCommand[]> {
  const commands: PendingCommand[] = [];

  // Collect Docker service commands
  const dockerState = await readState<DockerState>(syncDir, privateKey, 'docker-state');
  if (dockerState && dockerState[projectName]) {
    const projectDocker = dockerState[projectName];
    if (projectDocker) {
      for (const service of projectDocker.services) {
        if (service.autoStart) {
          commands.push({
            command: `docker compose up -d ${service.name}`,
            label: '🐳 Docker services',
            port: service.port,
            image: service.image,
            cwd: projectDocker.composeFile
              ? path.dirname(projectDocker.composeFile)
              : undefined,
          });
        }
      }
    }
  }

  // Collect auto-start service commands
  const serviceState = await readState<ServiceState>(syncDir, privateKey, 'services');
  if (serviceState) {
    const projectServices = serviceState.services.filter(
      (s) => s.project === projectName && s.autoStart,
    );
    for (const service of projectServices) {
      commands.push({
        command: service.command,
        label: '⚡ Auto-start services',
        port: service.port,
      });
    }
  }

  return commands;
}

/**
 * Write env vars to a .env file in the project directory.
 *
 * Creates or overwrites the .env file with all env vars for the project.
 * If the project directory does not exist, skips writing.
 *
 * @param projectPath - The absolute path to the project directory.
 * @param envVars - The decrypted env vars for the project.
 * @returns Whether the file was written.
 */
export function writeEnvFile(
  projectPath: string,
  envVars: Record<string, { value: string; addedAt: string }>,
): boolean {
  if (!fs.existsSync(projectPath)) {
    return false;
  }

  const lines: string[] = [];
  lines.push('# Generated by ctx-sync restore');
  lines.push(`# ${new Date().toISOString()}`);
  lines.push('');

  for (const [key, entry] of Object.entries(envVars)) {
    // Quote values that contain spaces, newlines, or special characters
    const needsQuotes = /[\s"'\\#]/.test(entry.value) || entry.value === '';
    const escapedValue = needsQuotes
      ? `"${entry.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
      : entry.value;
    lines.push(`${key}=${escapedValue}`);
  }

  const envPath = path.join(projectPath, '.env');
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
  return true;
}

/**
 * Attempt to checkout the correct git branch in the project directory.
 *
 * If the project has a local git repo and the branch exists, checks it out.
 * Does not fail if the branch doesn't exist or git is not available.
 *
 * @param projectPath - The absolute path to the project directory.
 * @param branch - The branch to checkout.
 * @returns Whether the branch was checked out.
 */
export async function checkoutBranch(
  projectPath: string,
  branch: string,
): Promise<boolean> {
  if (!fs.existsSync(path.join(projectPath, '.git'))) {
    return false;
  }

  if (!branch || branch === 'unknown') {
    return false;
  }

  try {
    const { createGit } = await import('../core/git-sync.js');
    const git = createGit(projectPath);

    // Check current branch — skip if already on the right branch
    const branchResult = await git.branch();
    if (branchResult.current === branch) {
      return true;
    }

    // Try to checkout the branch
    await git.checkout(branch);
    return true;
  } catch {
    // Branch may not exist locally — that's OK
    return false;
  }
}

/**
 * Resolve the effective local path for a project during restore.
 *
 * Uses the following resolution order (first match wins):
 * 1. Explicit `--path` override from the user.
 * 2. Stored path exists on disk — same machine or identical layout.
 * 3. Non-interactive fallback — use `process.cwd()` and log a warning.
 *
 * @param storedPath - The absolute path stored in the encrypted state (from the tracking machine).
 * @param options - Restore command options (may contain `localPath` override).
 * @returns An object with the resolved path and whether it differs from the stored path.
 */
export function resolveLocalPath(
  storedPath: string,
  options: Pick<RestoreOptions, 'localPath' | 'noInteractive'> = {},
): { resolvedPath: string; pathResolved: boolean } {
  // 1. Explicit --path override
  if (options.localPath) {
    const resolved = path.resolve(options.localPath);
    return { resolvedPath: resolved, pathResolved: resolved !== storedPath };
  }

  // 2. Stored path exists on this machine
  if (fs.existsSync(storedPath)) {
    return { resolvedPath: storedPath, pathResolved: false };
  }

  // 3. Fallback to cwd with a warning
  const cwd = process.cwd();
  return { resolvedPath: cwd, pathResolved: true };
}

/**
 * Execute the restore command logic.
 *
 * Decrypts state, displays project context, presents commands for
 * approval, and restores env vars and git branch. Supports cross-machine
 * restore via `--path` flag or automatic path fallback.
 *
 * @param projectName - The name of the project to restore.
 * @param options - Restore command options.
 * @returns Restore result with all operation details.
 */
export async function executeRestore(
  projectName: string,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // Verify sync dir exists
  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error('No sync repository found. Run `ctx-sync init` first.');
  }

  // Auto-pull latest from remote before restoring (unless --no-pull)
  let pulled = false;
  if (!options.noPull) {
    const { validateSyncRemote, pullWithConflictDetection, resolveConflicts } = await import('./sync.js');
    const remoteUrl = await validateSyncRemote(syncDir);
    if (remoteUrl) {
      const pullResult = await pullWithConflictDetection(syncDir);
      pulled = pullResult.pulled;
      if (pullResult.conflictFiles.length > 0) {
        await resolveConflicts(syncDir, pullResult.conflictFiles, true);
      }
    }
  }

  // Load key
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);
  // publicKey is available for future use (re-encryption after restore)
  void publicKey;

  // 1. Decrypt state and find the project
  const state = await readState<StateFile>(syncDir, privateKey, 'state');
  if (!state) {
    throw new Error('No state file found. Track a project first with `ctx-sync track`.');
  }

  const project = state.projects.find(
    (p) => p.name === projectName || p.id === projectName,
  );
  if (!project) {
    const availableNames = state.projects.map((p) => p.name).join(', ');
    throw new Error(
      `Project "${projectName}" not found.\n` +
        (availableNames
          ? `Available projects: ${availableNames}`
          : 'No projects tracked yet. Run `ctx-sync track` first.'),
    );
  }

  // Resolve the effective local path (cross-machine support)
  const { resolvedPath: localPath, pathResolved } = resolveLocalPath(
    project.path,
    options,
  );

  if (pathResolved && !options.localPath) {
    // Warn when falling back to cwd (not an explicit override)
    console.warn(
      `⚠️  Stored path "${project.path}" not found on this machine. Using "${localPath}" instead.`,
    );
  }

  // 2. Count env vars
  const envVars = await readState<EnvVars>(syncDir, privateKey, 'env-vars');
  const projectEnvVars = envVars?.[project.name] ?? {};
  const envVarCount = Object.keys(projectEnvVars).length;

  // 3. Load mental context
  const mentalContextData = await readState<MentalContext>(
    syncDir,
    privateKey,
    'mental-context',
  );
  const mentalContext = mentalContextData?.[project.name] ?? null;

  // 4. Collect commands to be executed
  const commandsPresented = await collectRestoreCommands(
    project.name,
    syncDir,
    privateKey,
  );

  // 5. Present commands for approval
  const approval = await presentCommandsForApproval(commandsPresented, {
    interactive: !options.noInteractive,
    promptFn: options.promptFn,
    selectFn: options.selectFn,
  });

  // 6. Execute approved commands (using resolved local path)
  const executedCommands: string[] = [];
  const failedCommands: Array<{ command: string; error: string }> = [];

  for (const cmd of approval.approved) {
    try {
      const { execSync } = await import('node:child_process');
      execSync(cmd.command, {
        cwd: cmd.cwd ?? localPath,
        stdio: 'pipe',
        timeout: 60000,
      });
      executedCommands.push(cmd.command);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failedCommands.push({ command: cmd.command, error: message });
    }
  }

  // 7. Write env vars to .env file (using resolved local path)
  let envFileWritten = false;
  if (envVarCount > 0 && fs.existsSync(localPath)) {
    envFileWritten = writeEnvFile(localPath, projectEnvVars);
  }

  // 8. Checkout git branch (using resolved local path)
  const branchCheckedOut = await checkoutBranch(
    localPath,
    project.git.branch,
  );

  return {
    project,
    pulled,
    envVarCount,
    envFileWritten,
    branchCheckedOut,
    mentalContext,
    commandsPresented,
    approval,
    executedCommands,
    failedCommands,
    localPath,
    pathResolved,
  };
}

/**
 * Format mental context for terminal display.
 *
 * @param context - The mental context to display.
 * @returns Formatted string for terminal output.
 */
export function formatMentalContext(context: ProjectMentalContext): string {
  const lines: string[] = [];

  if (context.currentTask) {
    lines.push(`📝 You were working on:`);
    lines.push(`   "${context.currentTask}"`);
  }

  if (context.lastWorkingOn) {
    lines.push('');
    lines.push(`   Last file: ${context.lastWorkingOn.file}:${context.lastWorkingOn.line}`);
    if (context.lastWorkingOn.description) {
      lines.push(`   ${context.lastWorkingOn.description}`);
    }
  }

  if (context.blockers.length > 0) {
    lines.push('');
    lines.push('   ⛔ Blockers:');
    for (const blocker of context.blockers) {
      lines.push(`   • ${blocker.description}`);
    }
  }

  if (context.nextSteps.length > 0) {
    lines.push('');
    lines.push('   Next steps:');
    for (const step of context.nextSteps) {
      lines.push(`   • ${step}`);
    }
  }

  if (context.relatedLinks.length > 0) {
    lines.push('');
    lines.push('   🔗 Related:');
    for (const link of context.relatedLinks) {
      lines.push(`   • ${link.title}: ${link.url}`);
    }
  }

  if (context.breadcrumbs.length > 0) {
    lines.push('');
    lines.push('   🍞 Breadcrumbs:');
    for (const crumb of context.breadcrumbs) {
      lines.push(`   • ${crumb.note}`);
    }
  }

  return lines.join('\n');
}

/**
 * Register the `restore` command on the given Commander program.
 */
export function registerRestoreCommand(program: Command): void {
  program
    .command('restore <project>')
    .description('Restore a tracked project on this machine')
    .option('--no-interactive', 'Show commands but skip execution (safe default)')
    .option('--no-pull', 'Skip pulling from remote before restoring')
    .option('--path <dir>', 'Local project directory (use when the project is at a different path on this machine)')
    .action(withErrorHandler(async (projectName: string, opts: Record<string, unknown>) => {
      const options: RestoreOptions = {
        noInteractive: opts['interactive'] === false,
        noPull: opts['pull'] === false,
        localPath: opts['path'] as string | undefined,
      };

      const chalk = (await import('chalk')).default;
      const { default: ora } = await import('ora');

      const spinner = ora(options.noPull ? 'Decrypting state files...' : 'Pulling latest and decrypting...').start();

      const result = await executeRestore(projectName, options);

      spinner.stop();

      // Display pull result
      if (result.pulled) {
        console.log(chalk.green('✅ Pulled latest from remote'));
      }

      // Display project info
      console.log(chalk.green(`\n✅ Restored: ${result.project.name}`));
      console.log('');
      if (result.pathResolved) {
        console.log(`📂 Directory: ${result.localPath}`);
        console.log(chalk.dim(`   (tracked path: ${result.project.path})`));
      } else {
        console.log(`📂 Directory: ${result.localPath}`);
      }
      console.log(`🌿 Branch: ${result.project.git.branch}`);
      console.log(`🔐 Env vars: ${result.envVarCount} decrypted`);

      if (result.branchCheckedOut) {
        console.log(chalk.dim('   Git branch checked out'));
      }

      if (result.envFileWritten) {
        console.log(chalk.dim('   .env file written'));
      }

      // Display mental context
      if (result.mentalContext) {
        console.log('');
        console.log(formatMentalContext(result.mentalContext));
      }

      // Display commands
      if (result.commandsPresented.length > 0) {
        console.log('');
        console.log(chalk.yellow('⚠️  The following commands will be executed:'));
        console.log(formatCommandsForDisplay(result.commandsPresented));
        console.log('');

        if (result.approval.skippedAll) {
          console.log(chalk.dim('Skipped (non-interactive mode)'));
        } else {
          // Show execution results
          for (const cmd of result.executedCommands) {
            console.log(chalk.green(`   ✓ ${cmd}`));
          }
          for (const { command, error } of result.failedCommands) {
            console.log(chalk.red(`   ✗ ${command}: ${error}`));
          }
          for (const cmd of result.approval.rejected) {
            console.log(chalk.dim(`   ⏭️  Skipped: ${cmd.command}`));
          }
        }
      }

      console.log('');
      console.log(chalk.green('Ready to work! 🚀'));
    }));
}
