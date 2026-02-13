/**
 * `ctx-sync service` command group.
 *
 * Manages running service state:
 *   - `service add <project> <name>` — add / update a service.
 *   - `service remove <project> <name>` — remove a service.
 *   - `service list [project]` — list tracked services.
 *   - `service start <project>` — present auto-start commands for approval.
 *
 * **Security:** `service start` commands go through the command validator.
 * All start commands require explicit user confirmation — there is no
 * `--yes` or `--no-confirm` bypass.
 *
 * @module commands/service
 */

import { execSync } from 'node:child_process';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import type { StateFile, Service } from '@ctx-sync/shared';
import { STATE_FILES } from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { loadKey } from '../core/key-store.js';
import { readState } from '../core/state-manager.js';
import { commitState } from '../core/git-sync.js';
import {
  presentCommandsForApproval,
} from '../core/command-validator.js';
import type { PendingCommand, ApprovalResult } from '../core/command-validator.js';
import {
  createService,
  validateService,
  addService,
  removeService,
  loadProjectServices,
  loadServices,
  listServiceProjects,
  getAutoStartServices,
} from '../core/services-handler.js';
import { getConfigDir, getSyncDir } from './init.js';

// ─── Interfaces ───────────────────────────────────────────────────────────

/** Options for service add */
export interface ServiceAddOptions {
  port: number;
  command: string;
  autoStart?: boolean;
  noSync?: boolean;
}

/** Result of service add */
export interface ServiceAddResult {
  projectName: string;
  serviceName: string;
  port: number;
  command: string;
  autoStart: boolean;
}

/** Options for service start */
export interface ServiceStartOptions {
  /** Non-interactive mode: show commands but skip execution */
  noInteractive?: boolean;
  /** Override prompt function (for testing) */
  promptFn?: (commands: PendingCommand[]) => Promise<'all' | 'none' | 'select'>;
  /** Override per-command select function (for testing) */
  selectFn?: (cmd: PendingCommand, index: number) => Promise<boolean>;
}

/** Result of service start */
export interface ServiceStartResult {
  projectName: string;
  commandsPresented: PendingCommand[];
  approval: ApprovalResult;
  executedCommands: string[];
  failedCommands: Array<{ command: string; error: string }>;
}

// ─── Core Logic ───────────────────────────────────────────────────────────

/**
 * Resolve project name from argument or current directory context.
 */
async function resolveProjectName(
  projectArg: string,
  syncDir: string,
  privateKey: string,
): Promise<string> {
  // Check if the project exists in tracked state
  const stateData = await readState<StateFile>(syncDir, privateKey, 'state');
  if (stateData) {
    const match = stateData.projects.find((p) => p.name === projectArg);
    if (match) return match.name;
  }
  return projectArg;
}

/**
 * Execute `ctx-sync service add <project> <name>`.
 */
export async function executeServiceAdd(
  project: string,
  name: string,
  options: ServiceAddOptions,
): Promise<ServiceAddResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  const projectName = await resolveProjectName(project, syncDir, privateKey);

  const service: Service = createService(
    projectName,
    name,
    options.port,
    options.command,
    options.autoStart ?? false,
  );

  // Validate the service entry
  const errors = validateService(service);
  if (errors.length > 0) {
    throw new Error(`Invalid service:\n  ${errors.join('\n  ')}`);
  }

  await addService(syncDir, service, publicKey, privateKey);

  // Commit to sync repo
  if (!options.noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.SERVICES, STATE_FILES.MANIFEST],
      `service: add ${projectName}/${name}`,
    );
  }

  return {
    projectName,
    serviceName: name,
    port: options.port,
    command: options.command,
    autoStart: options.autoStart ?? false,
  };
}

/**
 * Execute `ctx-sync service remove <project> <name>`.
 */
export async function executeServiceRemove(
  project: string,
  name: string,
  noSync = false,
): Promise<boolean> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  const projectName = await resolveProjectName(project, syncDir, privateKey);
  const removed = await removeService(
    syncDir,
    projectName,
    name,
    publicKey,
    privateKey,
  );

  if (removed && !noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.SERVICES, STATE_FILES.MANIFEST],
      `service: remove ${projectName}/${name}`,
    );
  }

  return removed;
}

/**
 * Build commands for service start (without executing).
 */
export function buildServiceStartCommands(services: Service[]): PendingCommand[] {
  return services.map((s) => ({
    command: s.command,
    label: `Service: ${s.name} (port ${String(s.port)})`,
    cwd: undefined,
  }));
}

/**
 * Execute `ctx-sync service start <project>`.
 *
 * Shows auto-start services for user approval, then executes approved ones.
 */
export async function executeServiceStart(
  project: string,
  options: ServiceStartOptions = {},
): Promise<ServiceStartResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const projectName = await resolveProjectName(project, syncDir, privateKey);

  const autoStart = await getAutoStartServices(syncDir, privateKey, projectName);

  if (autoStart.length === 0) {
    return {
      projectName,
      commandsPresented: [],
      approval: { approved: [], rejected: [], skippedAll: false },
      executedCommands: [],
      failedCommands: [],
    };
  }

  const pendingCommands = buildServiceStartCommands(autoStart);

  // Present for approval (handles interactive/non-interactive mode)
  const approval = await presentCommandsForApproval(pendingCommands, {
    interactive: !options.noInteractive,
    promptFn: options.promptFn,
    selectFn: options.selectFn,
  });

  const executedCommands: string[] = [];
  const failedCommands: Array<{ command: string; error: string }> = [];

  for (const cmd of approval.approved) {
    try {
      execSync(cmd.command, { stdio: 'inherit', timeout: 30_000 });
      executedCommands.push(cmd.command);
    } catch (err: unknown) {
      failedCommands.push({
        command: cmd.command,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    projectName,
    commandsPresented: pendingCommands,
    approval,
    executedCommands,
    failedCommands,
  };
}

/**
 * Execute `ctx-sync service list [project]`.
 */
export async function executeServiceList(
  project?: string,
): Promise<{ project: string; services: Service[] }[]> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);

  if (project) {
    const projectName = await resolveProjectName(project, syncDir, privateKey);
    const services = await loadProjectServices(syncDir, privateKey, projectName);
    return [{ project: projectName, services }];
  }

  // All projects
  const state = await loadServices(syncDir, privateKey);
  const projects = await listServiceProjects(syncDir, privateKey);
  return projects.map((p) => ({
    project: p,
    services: state.services.filter((s) => s.project === p),
  }));
}

// ─── Commander Registration ───────────────────────────────────────────────

/**
 * Register the `ctx-sync service` command group on the given program.
 */
export function registerServiceCommand(program: Command): void {
  const serviceCmd = program
    .command('service')
    .description('Manage tracked development services');

  // ── service add ───────────────────────────────────────────────────
  serviceCmd
    .command('add <project> <name>')
    .description('Add or update a tracked service')
    .requiredOption('-p, --port <port>', 'Port number', parseInt)
    .requiredOption('-c, --command <cmd>', 'Start command')
    .option('-a, --auto-start', 'Mark as auto-start', false)
    .option('--no-sync', 'Skip committing to sync repo')
    .action(
      withErrorHandler(async (
        project: string,
        name: string,
        opts: { port: number; command: string; autoStart: boolean; sync: boolean },
      ) => {
        const result = await executeServiceAdd(project, name, {
          port: opts.port,
          command: opts.command,
          autoStart: opts.autoStart,
          noSync: !opts.sync,
        });
        console.log(`✓ Service "${result.serviceName}" added to project "${result.projectName}"`);
        console.log(`  Port: ${String(result.port)}`);
        console.log(`  Command: ${result.command}`);
        if (result.autoStart) {
          console.log('  Auto-start: yes');
        }
      }),
    );

  // ── service remove ────────────────────────────────────────────────
  serviceCmd
    .command('remove <project> <name>')
    .description('Remove a tracked service')
    .option('--no-sync', 'Skip committing to sync repo')
    .action(withErrorHandler(async (project: string, name: string, opts: { sync: boolean }) => {
      const removed = await executeServiceRemove(project, name, !opts.sync);
      if (removed) {
        console.log(`✓ Service "${name}" removed from project "${project}"`);
      } else {
        console.log(`Service "${name}" not found in project "${project}"`);
      }
    }));

  // ── service list ──────────────────────────────────────────────────
  serviceCmd
    .command('list [project]')
    .description('List tracked services')
    .action(withErrorHandler(async (project?: string) => {
      const results = await executeServiceList(project);

      if (results.length === 0 || results.every((r) => r.services.length === 0)) {
        console.log('No services tracked.');
        return;
      }

      for (const group of results) {
        if (group.services.length === 0) continue;
        console.log(`\n📦 ${group.project}:`);
        for (const svc of group.services) {
          const auto = svc.autoStart ? ' [auto-start]' : '';
          console.log(
            `  ${svc.name} — port ${String(svc.port)}${auto}`,
          );
          console.log(`    command: ${svc.command}`);
        }
      }
    }));

  // ── service start ─────────────────────────────────────────────────
  serviceCmd
    .command('start <project>')
    .description('Start auto-start services (requires approval)')
    .option('-n, --no-interactive', 'Show commands without executing')
    .action(withErrorHandler(async (project: string, opts: { interactive: boolean }) => {
      const result = await executeServiceStart(project, {
        noInteractive: !opts.interactive,
      });

      if (result.commandsPresented.length === 0) {
        console.log(
          `No auto-start services found for project "${result.projectName}".`,
        );
        return;
      }

      if (result.approval.skippedAll) {
        console.log('Service commands (non-interactive — skipped):');
        for (const cmd of result.commandsPresented) {
          console.log(`  ${cmd.label}: ${cmd.command}`);
        }
        console.log(
          '\n⚠ Non-interactive mode — commands shown but not executed.',
        );
        return;
      }

      if (result.executedCommands.length > 0) {
        console.log(
          `✓ Started ${String(result.executedCommands.length)} service(s)`,
        );
      }
      if (result.failedCommands.length > 0) {
        console.error(
          `✗ ${String(result.failedCommands.length)} service(s) failed to start`,
        );
        for (const f of result.failedCommands) {
          console.error(`  ${f.command}: ${f.error}`);
        }
      }
    }));
}
