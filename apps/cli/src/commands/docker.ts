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
 * @param projectName - The project name.
 * @param projectDocker - The Docker state for the project.
 * @returns List of pending commands for approval.
 */
export function buildDockerStartCommands(
  projectName: string,
  projectDocker: DockerState[string],
): PendingCommand[] {
  const commands: PendingCommand[] = [];

  for (const service of projectDocker.services) {
    if (service.autoStart) {
      commands.push({
        command: `docker compose up -d ${service.name}`,
        label: '🐳 Docker services',
        port: service.port > 0 ? service.port : undefined,
        image: service.image || undefined,
        cwd: projectDocker.composeFile
          ? path.dirname(projectDocker.composeFile)
          : undefined,
      });
    }
  }

  return commands;
}

/**
 * Execute Docker start: show Docker commands for approval and execute.
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

  // Build commands
  const commandsPresented = buildDockerStartCommands(projectName, projectDocker);

  if (commandsPresented.length === 0) {
    return {
      projectName,
      commandsPresented: [],
      approval: { approved: [], rejected: [], skippedAll: false },
      executedCommands: [],
      failedCommands: [],
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
  };
}

// ─── Stop Logic ───────────────────────────────────────────────────────────

/**
 * Execute Docker stop: stop all tracked services for a project.
 *
 * @param projectName - The project name.
 * @returns Stop result.
 */
export async function executeDockerStop(
  projectName: string,
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
    };
  }

  const composeDir = projectDocker.composeFile
    ? path.dirname(projectDocker.composeFile)
    : null;

  if (!composeDir || !fs.existsSync(composeDir)) {
    return {
      projectName,
      composeFound: false,
      stopped: false,
      error: `Compose directory not found: ${composeDir ?? 'unknown'}`,
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
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      projectName,
      composeFound: true,
      stopped: false,
      error: message,
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
    .action(withErrorHandler(async (projectName: string, opts: Record<string, unknown>) => {
      const options: DockerStartOptions = {
        noInteractive: opts['interactive'] === false,
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
    .action(withErrorHandler(async (projectName: string) => {
      const chalk = (await import('chalk')).default;
      const { default: ora } = await import('ora');

      if (!isDockerAvailable()) {
        console.error(chalk.red('Error: Docker is not available on this machine.'));
        process.exitCode = 1;
        return;
      }

      const spinner = ora(`Stopping Docker services for ${projectName}...`).start();
      const result = await executeDockerStop(projectName);
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
