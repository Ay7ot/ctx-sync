/**
 * `ctx-sync show <project>` command.
 *
 * Decrypts and displays the full context for a project — state,
 * env var count, mental context, Docker services, running services —
 * in a readable, formatted terminal output.
 *
 * This is the "at-a-glance" view that answers: "What was I doing on
 * this project, and what do I need to get back to work?"
 *
 * @module commands/show
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import type {
  StateFile,
  Project,
  EnvVars,
  DockerState,
  MentalContext,
  ServiceState,
  ProjectMentalContext,
} from '@ctx-sync/shared';
import { loadKey } from '../core/key-store.js';
import { readState } from '../core/state-manager.js';
import { getConfigDir, getSyncDir } from './init.js';

/** Result of the show command */
export interface ShowResult {
  /** The project entry */
  project: Project;
  /** Number of env vars for the project */
  envVarCount: number;
  /** Mental context for the project (if any) */
  mentalContext: ProjectMentalContext | null;
  /** Docker state for the project (if any) */
  dockerServices: Array<{
    name: string;
    image: string;
    port: number;
    autoStart: boolean;
  }>;
  /** Running services for the project (if any) */
  services: Array<{
    name: string;
    port: number;
    command: string;
    autoStart: boolean;
  }>;
}

/**
 * Execute the show command logic.
 *
 * Decrypts all relevant state files and assembles a complete project
 * context snapshot.
 *
 * @param projectName - The name of the project to show.
 * @returns The full project context.
 */
export async function executeShow(projectName: string): Promise<ShowResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // Verify sync dir exists
  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error('No sync repository found. Run `ctx-sync init` first.');
  }

  // Load key
  const privateKey = loadKey(configDir);

  // 1. Find the project in state
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

  // 4. Load Docker state
  const dockerState = await readState<DockerState>(syncDir, privateKey, 'docker-state');
  const projectDocker = dockerState?.[project.name];
  const dockerServices = projectDocker?.services.map((s) => ({
    name: s.name,
    image: s.image,
    port: s.port,
    autoStart: s.autoStart,
  })) ?? [];

  // 5. Load service state
  const serviceState = await readState<ServiceState>(syncDir, privateKey, 'services');
  const services = serviceState?.services
    .filter((s) => s.project === project.name)
    .map((s) => ({
      name: s.name,
      port: s.port,
      command: s.command,
      autoStart: s.autoStart,
    })) ?? [];

  return {
    project,
    envVarCount,
    mentalContext,
    dockerServices,
    services,
  };
}

/**
 * Format the project context for terminal display.
 *
 * Produces a readable, chalk-formatted output string that shows
 * all available context at a glance.
 *
 * @param result - The show result to format.
 * @param useChalk - Whether to use chalk for formatting (default: true).
 * @returns Formatted string for terminal output.
 */
export function formatShowOutput(result: ShowResult, _useChalk = true): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(`  Project: ${result.project.name}`);
  lines.push(`  ──────────────────────────────────`);

  // Project info
  lines.push('');
  lines.push(`  📂 Directory: ${result.project.path}`);
  lines.push(`  🌿 Branch:    ${result.project.git.branch}`);
  lines.push(`  🔐 Env vars:  ${result.envVarCount}`);

  if (result.project.git.hasUncommitted) {
    lines.push(`  ⚠  Uncommitted changes`);
  }

  if (result.project.git.stashCount > 0) {
    lines.push(`  📦 Stash count: ${result.project.git.stashCount}`);
  }

  lines.push(`  🕐 Last accessed: ${formatTimestamp(result.project.lastAccessed)}`);

  // Mental context
  if (result.mentalContext) {
    lines.push('');
    lines.push('  📝 Mental Context');
    lines.push('  ─────────────────');

    if (result.mentalContext.currentTask) {
      lines.push(`  Task: "${result.mentalContext.currentTask}"`);
    }

    if (result.mentalContext.lastWorkingOn) {
      const lwo = result.mentalContext.lastWorkingOn;
      lines.push('');
      lines.push(`  Last file: ${lwo.file}:${lwo.line}`);
      if (lwo.description) {
        lines.push(`  ${lwo.description}`);
      }
    }

    if (result.mentalContext.blockers.length > 0) {
      lines.push('');
      lines.push('  ⛔ Blockers:');
      for (const blocker of result.mentalContext.blockers) {
        const priority = blocker.priority === 'high' ? ' [HIGH]' : '';
        lines.push(`     • ${blocker.description}${priority}`);
      }
    }

    if (result.mentalContext.nextSteps.length > 0) {
      lines.push('');
      lines.push('  📋 Next Steps:');
      for (const step of result.mentalContext.nextSteps) {
        lines.push(`     • ${step}`);
      }
    }

    if (result.mentalContext.relatedLinks.length > 0) {
      lines.push('');
      lines.push('  🔗 Related Links:');
      for (const link of result.mentalContext.relatedLinks) {
        if (link.title !== link.url) {
          lines.push(`     • ${link.title}: ${link.url}`);
        } else {
          lines.push(`     • ${link.url}`);
        }
      }
    }

    if (result.mentalContext.breadcrumbs.length > 0) {
      lines.push('');
      lines.push('  🍞 Breadcrumbs:');
      for (const crumb of result.mentalContext.breadcrumbs) {
        lines.push(`     • ${crumb.note}`);
      }
    }
  }

  // Docker services
  if (result.dockerServices.length > 0) {
    lines.push('');
    lines.push('  🐳 Docker Services');
    lines.push('  ──────────────────');
    for (const svc of result.dockerServices) {
      const autoStart = svc.autoStart ? ' (auto-start)' : '';
      lines.push(`     • ${svc.name} — ${svc.image} (port ${svc.port})${autoStart}`);
    }
  }

  // Running services
  if (result.services.length > 0) {
    lines.push('');
    lines.push('  ⚡ Services');
    lines.push('  ──────────');
    for (const svc of result.services) {
      const autoStart = svc.autoStart ? ' (auto-start)' : '';
      lines.push(`     • ${svc.name} — \`${svc.command}\` (port ${svc.port})${autoStart}`);
    }
  }

  // No context sections at all
  if (
    !result.mentalContext &&
    result.dockerServices.length === 0 &&
    result.services.length === 0 &&
    result.envVarCount === 0
  ) {
    lines.push('');
    lines.push('  No additional context recorded yet.');
    lines.push('  Use `ctx-sync note` to add mental context.');
    lines.push('  Use `ctx-sync env import` to track environment variables.');
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Format an ISO timestamp for human-readable display.
 *
 * @param isoTimestamp - ISO 8601 timestamp string.
 * @returns Formatted date/time string.
 */
function formatTimestamp(isoTimestamp: string): string {
  try {
    const date = new Date(isoTimestamp);
    return date.toLocaleString();
  } catch {
    return isoTimestamp;
  }
}

/**
 * Register the `show` command on the given Commander program.
 */
export function registerShowCommand(program: Command): void {
  program
    .command('show <project>')
    .description('Show full context for a tracked project')
    .action(withErrorHandler(async (projectName: string) => {
      const chalk = (await import('chalk')).default;

      const result = await executeShow(projectName);
      const output = formatShowOutput(result);

      console.log(output);

      // Summary line
      const sections: string[] = [];
      if (result.mentalContext) {
        sections.push('mental context');
      }
      if (result.envVarCount > 0) {
        sections.push(`${result.envVarCount} env vars`);
      }
      if (result.dockerServices.length > 0) {
        sections.push(`${result.dockerServices.length} Docker services`);
      }
      if (result.services.length > 0) {
        sections.push(`${result.services.length} services`);
      }

      if (sections.length > 0) {
        console.log(chalk.dim(`  Context includes: ${sections.join(', ')}`));
        console.log('');
      }
    }));
}
