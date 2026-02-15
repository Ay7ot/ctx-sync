/**
 * `ctx-sync docker` command group.
 *
 * Manages Docker container state for tracked projects:
 *   - `docker track <project>` — detect and save Docker Compose state.
 *   - `docker start <project>` — show Docker commands for approval, then execute.
 *   - `docker stop <project>` — stop tracked services.
 *   - `docker status [project]` — show running / tracked services.
 *
 * **Security:** `docker start` commands go through the command validator.
 * All start commands require explicit user confirmation — there is no
 * `--yes` or `--no-confirm` bypass.
 *
 * @module commands/docker
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import type { StateFile, DockerState } from '@ctx-sync/shared';
import { STATE_FILES } from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { loadKey } from '../core/key-store.js';
import { readState } from '../core/state-manager.js';
import { commitState } from '../core/git-sync.js';
import {
  formatCommandsForDisplay,
  presentCommandsForApproval,
} from '../core/command-validator.js';
import type { PendingCommand, ApprovalResult } from '../core/command-validator.js';
import {
  detectDockerCompose,
  buildDockerStateEntry,
  saveDockerState,
  loadDockerState,
  loadAllDockerState,
  isDockerAvailable,
} from '../core/docker-handler.js';
import { getConfigDir, getSyncDir } from './init.js';

// ─── Interfaces ───────────────────────────────────────────────────────────

/** Options for docker track */
export interface DockerTrackOptions {
  /** Path to the project directory (default: CWD) */
  path?: string;
  /** Project name override */
  project?: string;
  /** Skip committing to sync repo */
  noSync?: boolean;
}

/** Result of docker track */
export interface DockerTrackResult {
  /** The project name */
  projectName: string;
  /** Number of services detected */
  serviceCount: number;
  /** Names of detected services */
  serviceNames: string[];
  /** Compose file path */
  composeFile: string;
  /** Networks defined */
  networks: string[];
}

/** Options for docker start */
export interface DockerStartOptions {
  /** Non-interactive mode: show commands but skip execution */
  noInteractive?: boolean;
  /** Explicit local path override for the project directory (cross-machine support) */
  localPath?: string;
  /** Override prompt function (for testing) */
  promptFn?: (commands: PendingCommand[]) => Promise<'all' | 'none' | 'select'>;
  /** Override per-command select function (for testing) */
  selectFn?: (cmd: PendingCommand, index: number) => Promise<boolean>;
}

/** Result of docker start */
export interface DockerStartResult {
  /** The project name */
  projectName: string;
  /** Commands that were presented for approval */
  commandsPresented: PendingCommand[];
  /** Approval result */
  approval: ApprovalResult;
  /** Commands that were executed successfully */
  executedCommands: string[];
  /** Commands that failed */
  failedCommands: Array<{ command: string; error: string }>;
  /** The resolved local directory used for Docker commands */
  localPath?: string;
  /** Whether the path was resolved differently from the stored compose file dir */
  pathResolved: boolean;
}

/** Options for docker stop */
export interface DockerStopOptions {
  /** Explicit local path override for the project directory (cross-machine support) */
  localPath?: string;
}

/** Result of docker stop */
export interface DockerStopResult {
  /** The project name */
  projectName: string;
  /** Whether Docker Compose was found */
  composeFound: boolean;
  /** Whether the stop command succeeded */
  stopped: boolean;
  /** Error message if stop failed */
  error?: string;
  /** The resolved local directory used for Docker commands */
  localPath?: string;
  /** Whether the path was resolved differently from the stored compose file dir */
  pathResolved: boolean;
}

/** Docker service status info */
export interface DockerServiceStatus {
  /** Service name */
  name: string;
  /** Docker image */
  image: string;
  /** Port */
  port: number;
  /** Whether auto-start is enabled */
  autoStart: boolean;
  /** Compose file path */
  composeFile: string;
}

/** Result of docker status */
export interface DockerStatusResult {
  /** All tracked projects and their services */
  projects: Array<{
    projectName: string;
    composeFile: string;
    services: DockerServiceStatus[];
  }>;
}

// ─── Path Resolution ──────────────────────────────────────────────────────

/**
 * Resolve the effective directory for Docker Compose operations.
 *
 * Uses the following resolution order (first match wins):
 * 1. Explicit `--path` override from the user.
 * 2. Stored compose directory exists on disk — same machine or identical layout.
 * 3. Fallback — use `process.cwd()`.
 *
 * @param storedComposeFile - The absolute compose file path stored in encrypted state.
 * @param options - Options with optional `localPath` override.
 * @returns An object with the resolved directory and whether it differs from the stored dir.
 */
export function resolveDockerComposeDir(
  storedComposeFile: string,
  options: { localPath?: string } = {},
): { resolvedDir: string; pathResolved: boolean } {
  const storedDir = path.dirname(storedComposeFile);

  // 1. Explicit --path override
  if (options.localPath) {
    const resolved = path.resolve(options.localPath);
    return { resolvedDir: resolved, pathResolved: resolved !== storedDir };
  }

  // 2. Stored dir exists on this machine
  if (fs.existsSync(storedDir)) {
    return { resolvedDir: storedDir, pathResolved: false };
  }

  // 3. Fallback to cwd
  const cwd = process.cwd();
  return { resolvedDir: cwd, pathResolved: true };
}

// ─── Track Logic ──────────────────────────────────────────────────────────

/**
 * Execute Docker track: detect and save Docker Compose state.
 *
 * @param options - Track options.
 * @returns Track result.
 */
export async function executeDockerTrack(
  options: DockerTrackOptions = {},
): Promise<DockerTrackResult> {
  const projectDir = options.path ?? process.cwd();
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // Verify sync dir exists
  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error('No sync repository found. Run `ctx-sync init` first.');
  }

  // Load key
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  // Determine project name
  let projectName = options.project;
  if (!projectName) {
    // Try to find from tracked projects
    const state = await readState<StateFile>(syncDir, privateKey, 'state');
    const matchingProject = state?.projects.find(
      (p) => p.path === path.resolve(projectDir),
    );
    projectName = matchingProject?.name ?? path.basename(path.resolve(projectDir));
  }

  // Detect compose file
  const compose = detectDockerCompose(projectDir);
  if (!compose.found || !compose.filePath) {
    throw new Error(
      `No Docker Compose file found in ${projectDir}.\n` +
        'Expected: docker-compose.yml, docker-compose.yaml, compose.yml, or compose.yaml',
    );
  }

  // Build and save Docker state
  const entry = buildDockerStateEntry(projectName, projectDir);
  if (!entry) {
    throw new Error('Failed to parse Docker Compose file.');
  }

  await saveDockerState(syncDir, projectName, entry, publicKey, privateKey);

  // Commit if requested
  if (!options.noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.DOCKER_STATE, STATE_FILES.MANIFEST],
      `feat: track Docker services for ${projectName}`,
    );
  }

  return {
    projectName,
    serviceCount: entry.services.length,
    serviceNames: entry.services.map((s) => s.name),
    composeFile: compose.filePath,
    networks: entry.networks ?? [],
  };
}

// ─── Start Logic ──────────────────────────────────────────────────────────

/**
 * Build pending commands from tracked Docker services.
 *
 * Supports cross-machine path resolution: when `localPath` is provided or
 * the stored compose directory doesn't exist, commands use the resolved path.
 *
 * @param projectName - The project name.
 * @param projectDocker - The Docker state for the project.
 * @param localPath - Optional override for the project directory (cross-machine support).
 * @returns List of pending commands for approval.
 */
export function buildDockerStartCommands(
  projectName: string,
  projectDocker: DockerState[string],
  localPath?: string,
): PendingCommand[] {
  const commands: PendingCommand[] = [];

  // Resolve compose directory with cross-machine fallback
  const resolvedCwd = projectDocker.composeFile
    ? resolveDockerComposeDir(projectDocker.composeFile, { localPath }).resolvedDir
    : localPath ?? undefined;

  for (const service of projectDocker.services) {
    if (service.autoStart) {
      commands.push({
        command: `docker compose up -d ${service.name}`,
        label: '🐳 Docker services',
        port: service.port > 0 ? service.port : undefined,
        image: service.image || undefined,
        cwd: resolvedCwd,
      });
    }
  }

  return commands;
}

/**
 * Execute Docker start: show Docker commands for approval and execute.
 *
 * Supports cross-machine path resolution via `--path` option. When the
 * stored compose directory doesn't exist, falls back to `--path` or `cwd`.
 *
 * @param projectName - The project name.
 * @param options - Start options.
 * @returns Start result.
 */
export async function executeDockerStart(
  projectName: string,
  options: DockerStartOptions = {},
): Promise<DockerStartResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error('No sync repository found. Run `ctx-sync init` first.');
  }

  const privateKey = loadKey(configDir);

  // Load Docker state for the project
  const projectDocker = await loadDockerState(syncDir, projectName, privateKey);
  if (!projectDocker) {
    throw new Error(
      `No Docker state found for project "${projectName}".\n` +
        'Run `ctx-sync docker track` in the project directory first.',
    );
  }

  // Resolve compose directory (cross-machine support)
  let resolvedLocalPath: string | undefined;
  let pathResolved = false;

  if (projectDocker.composeFile) {
    const resolution = resolveDockerComposeDir(projectDocker.composeFile, {
      localPath: options.localPath,
    });
    resolvedLocalPath = resolution.resolvedDir;
    pathResolved = resolution.pathResolved;

    if (pathResolved && !options.localPath) {
      // Warn when falling back to cwd (not an explicit override)
      console.warn(
        `⚠️  Stored compose path "${projectDocker.composeFile}" not found on this machine. Using "${resolvedLocalPath}" instead.`,
      );
    }
  }

  // Build commands with resolved path
  const commandsPresented = buildDockerStartCommands(
    projectName,
    projectDocker,
    options.localPath ? path.resolve(options.localPath) : undefined,
  );

  if (commandsPresented.length === 0) {
    return {
      projectName,
      commandsPresented: [],
      approval: { approved: [], rejected: [], skippedAll: false },
      executedCommands: [],
      failedCommands: [],
      localPath: resolvedLocalPath,
      pathResolved,
    };
  }

  // Present for approval
  const approval = await presentCommandsForApproval(commandsPresented, {
    interactive: !options.noInteractive,
    promptFn: options.promptFn,
    selectFn: options.selectFn,
  });

  // Execute approved commands
  const executedCommands: string[] = [];
  const failedCommands: Array<{ command: string; error: string }> = [];

  for (const cmd of approval.approved) {
    try {
      execSync(cmd.command, {
        cwd: cmd.cwd ?? process.cwd(),
        stdio: 'pipe',
        timeout: 60000,
      });
      executedCommands.push(cmd.command);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failedCommands.push({ command: cmd.command, error: message });
    }
  }

  return {
    projectName,
    commandsPresented,
    approval,
    executedCommands,
    failedCommands,
    localPath: resolvedLocalPath,
    pathResolved,
  };
}

// ─── Stop Logic ───────────────────────────────────────────────────────────

/**
 * Execute Docker stop: stop all tracked services for a project.
 *
 * Supports cross-machine path resolution via `--path` option. When the
 * stored compose directory doesn't exist, falls back to `--path` or `cwd`.
 *
 * @param projectName - The project name.
 * @param options - Stop options (optional).
 * @returns Stop result.
 */
export async function executeDockerStop(
  projectName: string,
  options: DockerStopOptions = {},
): Promise<DockerStopResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error('No sync repository found. Run `ctx-sync init` first.');
  }

  const privateKey = loadKey(configDir);
  const projectDocker = await loadDockerState(syncDir, projectName, privateKey);

  if (!projectDocker) {
    return {
      projectName,
      composeFound: false,
      stopped: false,
      error: `No Docker state found for project "${projectName}".`,
      pathResolved: false,
    };
  }

  if (!projectDocker.composeFile) {
    return {
      projectName,
      composeFound: false,
      stopped: false,
      error: 'No compose file path stored for this project.',
      pathResolved: false,
    };
  }

  // Resolve compose directory (cross-machine support)
  const { resolvedDir: composeDir, pathResolved } = resolveDockerComposeDir(
    projectDocker.composeFile,
    { localPath: options.localPath },
  );

  if (pathResolved && !options.localPath) {
    // Warn when falling back to cwd (not an explicit override)
    console.warn(
      `⚠️  Stored compose path "${projectDocker.composeFile}" not found on this machine. Using "${composeDir}" instead.`,
    );
  }

  if (!fs.existsSync(composeDir)) {
    return {
      projectName,
      composeFound: false,
      stopped: false,
      error: `Compose directory not found: ${composeDir}`,
      localPath: composeDir,
      pathResolved,
    };
  }

  try {
    execSync('docker compose down', {
      cwd: composeDir,
      stdio: 'pipe',
      timeout: 30000,
    });
    return {
      projectName,
      composeFound: true,
      stopped: true,
      localPath: composeDir,
      pathResolved,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      projectName,
      composeFound: true,
      stopped: false,
      error: message,
      localPath: composeDir,
      pathResolved,
    };
  }
}

// ─── Status Logic ─────────────────────────────────────────────────────────

/**
 * Execute Docker status: show all tracked Docker projects and services.
 *
 * @param projectFilter - Optional project name to filter.
 * @returns Status result.
 */
export async function executeDockerStatus(
  projectFilter?: string,
): Promise<DockerStatusResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error('No sync repository found. Run `ctx-sync init` first.');
  }

  const privateKey = loadKey(configDir);
  const allDocker = await loadAllDockerState(syncDir, privateKey);

  if (!allDocker) {
    return { projects: [] };
  }

  const projects: DockerStatusResult['projects'] = [];

  for (const [name, entry] of Object.entries(allDocker)) {
    if (projectFilter && name !== projectFilter) continue;

    projects.push({
      projectName: name,
      composeFile: entry.composeFile,
      services: entry.services.map((s) => ({
        name: s.name,
        image: s.image,
        port: s.port,
        autoStart: s.autoStart,
        composeFile: entry.composeFile,
      })),
    });
  }

  return { projects };
}

// ─── CLI Registration ─────────────────────────────────────────────────────

/**
 * Register the `docker` command group on the given Commander program.
 */
export function registerDockerCommand(program: Command): void {
  const docker = program
    .command('docker')
    .description('Manage Docker container state for tracked projects');

  // docker track
  docker
    .command('track')
    .description('Track Docker Compose services for the current project')
    .option('-p, --path <path>', 'Project directory path (default: current directory)')
    .option('--project <name>', 'Project name override')
    .option('--no-sync', 'Skip syncing to Git after tracking')
    .action(withErrorHandler(async (opts: Record<string, unknown>) => {
      const options: DockerTrackOptions = {
        path: opts['path'] as string | undefined,
        project: opts['project'] as string | undefined,
        noSync: opts['sync'] === false,
      };

      const chalk = (await import('chalk')).default;
      const result = await executeDockerTrack(options);

      console.log(chalk.green(`\n✅ Docker services tracked for ${result.projectName}`));
      console.log(`   Compose file: ${result.composeFile}`);
      console.log(`   Services (${result.serviceCount}):`);
      for (const name of result.serviceNames) {
        console.log(`     • ${name}`);
      }
      if (result.networks.length > 0) {
        console.log(`   Networks: ${result.networks.join(', ')}`);
      }
      console.log(chalk.dim('\n   State encrypted and saved to docker-state.age'));
    }));

  // docker start <project>
  docker
    .command('start <project>')
    .description('Start tracked Docker services (with confirmation)')
    .option('--no-interactive', 'Show commands but skip execution')
    .option('--path <dir>', 'Local project directory (use when Docker Compose is at a different path on this machine)')
    .action(withErrorHandler(async (projectName: string, opts: Record<string, unknown>) => {
      const options: DockerStartOptions = {
        noInteractive: opts['interactive'] === false,
        localPath: opts['path'] as string | undefined,
      };

      const chalk = (await import('chalk')).default;

      if (!isDockerAvailable()) {
        console.error(chalk.red('Error: Docker is not available on this machine.'));
        process.exitCode = 1;
        return;
      }

      const result = await executeDockerStart(projectName, options);

      if (result.commandsPresented.length === 0) {
        console.log(chalk.yellow('No auto-start Docker services configured.'));
        return;
      }

      // Show path resolution info if path differs
      if (result.pathResolved && result.localPath) {
        console.log(chalk.dim(`   Using project directory: ${result.localPath}`));
      }

      console.log(chalk.yellow('\n⚠️  The following Docker commands will be executed:'));
      console.log(formatCommandsForDisplay(result.commandsPresented));
      console.log('');

      if (result.approval.skippedAll) {
        console.log(chalk.dim('Skipped (non-interactive mode)'));
      } else {
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
    }));

  // docker stop <project>
  docker
    .command('stop <project>')
    .description('Stop tracked Docker services')
    .option('--path <dir>', 'Local project directory (use when Docker Compose is at a different path on this machine)')
    .action(withErrorHandler(async (projectName: string, opts: Record<string, unknown>) => {
      const chalk = (await import('chalk')).default;
      const { default: ora } = await import('ora');

      if (!isDockerAvailable()) {
        console.error(chalk.red('Error: Docker is not available on this machine.'));
        process.exitCode = 1;
        return;
      }

      const stopOptions: DockerStopOptions = {
        localPath: opts['path'] as string | undefined,
      };

      const spinner = ora(`Stopping Docker services for ${projectName}...`).start();
      const result = await executeDockerStop(projectName, stopOptions);
      spinner.stop();

      if (!result.composeFound) {
        console.log(chalk.yellow(result.error ?? 'No Docker state found.'));
        return;
      }

      if (result.stopped) {
        console.log(chalk.green(`✅ Docker services stopped for ${projectName}`));
      } else {
        console.error(chalk.red(`Failed to stop: ${result.error}`));
        process.exitCode = 1;
      }
    }));

  // docker status [project]
  docker
    .command('status [project]')
    .description('Show tracked Docker services')
    .action(withErrorHandler(async (projectFilter?: string) => {
      const chalk = (await import('chalk')).default;
      const result = await executeDockerStatus(projectFilter);

      if (result.projects.length === 0) {
        console.log(chalk.yellow('No Docker services tracked.'));
        console.log(
          chalk.dim('Run `ctx-sync docker track` in a project with a Docker Compose file.'),
        );
        return;
      }

      for (const project of result.projects) {
        console.log(chalk.bold(`\n🐳 ${project.projectName}`));
        console.log(chalk.dim(`   Compose: ${project.composeFile}`));
        for (const svc of project.services) {
          const portStr = svc.port > 0 ? ` (port ${svc.port})` : '';
          const autoStr = svc.autoStart ? ' [auto-start]' : '';
          const imageStr = svc.image ? ` — ${svc.image}` : '';
          console.log(`   • ${svc.name}${imageStr}${portStr}${autoStr}`);
        }
      }
    }));
}
