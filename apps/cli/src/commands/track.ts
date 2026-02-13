/**
 * `ctx-sync track` command.
 *
 * Detects the current project's Git state, validates the path,
 * encrypts the project entry, and writes it to `state.age`.
 *
 * Phase 4 scope: .env detection is noted but import is deferred to Phase 5.
 * Docker-compose detection is noted but deferred to Phase 9.
 * Mental context is deferred to Phase 8.
 *
 * @module commands/track
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { Command } from 'commander';
import type { Project, StateFile } from '@ctx-sync/shared';
import { STATE_FILES } from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { validateProjectPath } from '../core/path-validator.js';
import { loadKey } from '../core/key-store.js';
import { readState, writeState } from '../core/state-manager.js';
import { commitState } from '../core/git-sync.js';
import { getConfigDir, getSyncDir } from './init.js';

/** Options for the track command */
export interface TrackOptions {
  /** Override the auto-detected project name */
  name?: string;
  /** Path to the project directory (default: CWD) */
  path?: string;
  /** Skip committing/pushing to sync repo */
  noSync?: boolean;
}

/** Result returned by executeTrack */
export interface TrackResult {
  /** The project entry that was created or updated */
  project: Project;
  /** Whether this is a newly tracked project (vs. update) */
  isNew: boolean;
  /** Whether a .env file was found in the project */
  envFileFound: boolean;
  /** Whether a docker-compose file was found in the project */
  dockerComposeFound: boolean;
}

/**
 * Detect Git information for a project directory.
 *
 * @param projectPath - Absolute path to the project directory.
 * @returns Git metadata (branch, remote, uncommitted, stash count).
 */
export async function detectGitInfo(
  projectPath: string,
): Promise<Project['git']> {
  const defaultGit: Project['git'] = {
    branch: 'unknown',
    remote: '',
    hasUncommitted: false,
    stashCount: 0,
  };

  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) {
    return defaultGit;
  }

  try {
    const { simpleGit } = await import('simple-git');
    const git = simpleGit(projectPath);

    // Branch
    const branchResult = await git.branch();
    const branch = branchResult.current || 'unknown';

    // Remote
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    const remote = origin?.refs?.fetch ?? '';

    // Uncommitted changes
    const status = await git.status();
    const hasUncommitted = !status.isClean();

    // Stash count
    let stashCount = 0;
    try {
      const stashList = await git.stashList();
      stashCount = stashList.total;
    } catch {
      // stash list can fail on repos with no stashes — that's fine
    }

    return { branch, remote, hasUncommitted, stashCount };
  } catch {
    return defaultGit;
  }
}

/**
 * Derive the machine ID for the current host.
 *
 * Uses hostname as a simple machine identifier.
 * A more robust approach (hardware ID) can be added later.
 */
function getMachineInfo(): { id: string; hostname: string } {
  const hostname = os.hostname();
  return {
    id: crypto.createHash('sha256').update(hostname).digest('hex').slice(0, 16),
    hostname,
  };
}

/**
 * Execute the track command logic.
 *
 * 1. Resolve and validate the project path.
 * 2. Detect Git info.
 * 3. Note .env and docker-compose presence (deferred features).
 * 4. Build or update the Project entry.
 * 5. Encrypt and write state.age.
 * 6. Optionally commit to the sync repo.
 *
 * @param options - Track command options.
 * @returns Track result including the project entry.
 */
export async function executeTrack(options: TrackOptions): Promise<TrackResult> {
  // 1. Resolve and validate path
  const rawPath = options.path ?? process.cwd();
  const projectPath = validateProjectPath(rawPath);

  // 2. Detect project name
  const projectName = options.name ?? path.basename(projectPath);

  // 3. Load key and derive public key
  const configDir = getConfigDir();
  const syncDir = getSyncDir();
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  // 4. Detect Git info
  const gitInfo = await detectGitInfo(projectPath);

  // 5. Check for .env and docker-compose (note only, defer to future phases)
  const envFileFound = fs.existsSync(path.join(projectPath, '.env'));
  const dockerComposeFound =
    fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
    fs.existsSync(path.join(projectPath, 'docker-compose.yaml')) ||
    fs.existsSync(path.join(projectPath, 'compose.yml')) ||
    fs.existsSync(path.join(projectPath, 'compose.yaml'));

  // 6. Read existing state (or create new)
  const existingState = await readState<StateFile>(syncDir, privateKey, 'state');
  const machine = getMachineInfo();

  const state: StateFile = existingState ?? {
    machine,
    projects: [],
  };

  // Ensure machine info is current
  state.machine = machine;

  // 7. Find or create project entry
  const existingIndex = state.projects.findIndex(
    (p) => p.path === projectPath,
  );
  const isNew = existingIndex === -1;

  const existingProject = isNew ? undefined : state.projects[existingIndex];

  const project: Project = {
    id: existingProject?.id ?? crypto.randomUUID(),
    name: projectName,
    path: projectPath,
    git: gitInfo,
    lastAccessed: new Date().toISOString(),
  };

  if (isNew) {
    state.projects.push(project);
  } else {
    state.projects[existingIndex] = project;
  }

  // 8. Write encrypted state
  await writeState(syncDir, state, publicKey, 'state');

  // 9. Optionally commit
  if (!options.noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.STATE, STATE_FILES.MANIFEST],
      `feat: ${isNew ? 'track' : 'update'} project ${projectName}`,
    );
  }

  return { project, isNew, envFileFound, dockerComposeFound };
}

/**
 * Register the `track` command on the given Commander program.
 */
export function registerTrackCommand(program: Command): void {
  program
    .command('track')
    .description('Track the current project directory')
    .option('-n, --name <name>', 'Project name (default: directory name)')
    .option('-p, --path <path>', 'Project path (default: current directory)')
    .option('--no-sync', 'Skip syncing to Git after tracking')
    .action(async (opts: Record<string, unknown>) => {
      const options: TrackOptions = {
        name: opts['name'] as string | undefined,
        path: opts['path'] as string | undefined,
        noSync: opts['sync'] === false,
      };

      try {
        const result = await executeTrack(options);
        const chalk = (await import('chalk')).default;

        if (result.isNew) {
          console.log(
            chalk.green('✅ Tracking project: ') + result.project.name,
          );
        } else {
          console.log(
            chalk.green('✅ Updated project: ') + result.project.name,
          );
        }

        console.log(`   Path: ${result.project.path}`);
        console.log(`   Branch: ${result.project.git.branch}`);

        if (result.project.git.hasUncommitted) {
          console.log(chalk.yellow('   ⚠ Uncommitted changes detected'));
        }

        if (result.project.git.stashCount > 0) {
          console.log(
            chalk.yellow(`   ⚠ ${result.project.git.stashCount} stash(es)`),
          );
        }

        if (result.envFileFound) {
          console.log(
            chalk.cyan(
              '   ℹ .env file found — use `ctx-sync env import` to track environment variables',
            ),
          );
        }

        if (result.dockerComposeFound) {
          console.log(
            chalk.cyan(
              '   ℹ Docker Compose found — use `ctx-sync docker track` to track services',
            ),
          );
        }

        console.log(
          chalk.dim('\n   State encrypted and saved to state.age'),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });
}
