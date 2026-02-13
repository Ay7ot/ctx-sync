/**
 * `ctx-sync track` command.
 *
 * Detects the current project's Git state, validates the path,
 * encrypts the project entry, and writes it to `state.age`.
 *
 * Phase 16 enhancements: Step-by-step wizard with auto-detection,
 * .env import, Docker tracking, mental context, and summary.
 * `--yes` flag skips interactive confirmations (but NOT restore commands).
 *
 * @module commands/track
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type { Command } from 'commander';
import type { Project, StateFile, MentalContext } from '@ctx-sync/shared';
import { STATE_FILES } from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { validateProjectPath } from '../core/path-validator.js';
import { loadKey } from '../core/key-store.js';
import { readState, writeState } from '../core/state-manager.js';
import { commitState } from '../core/git-sync.js';
import { getConfigDir, getSyncDir } from './init.js';
import { withErrorHandler } from '../utils/errors.js';

/** Options for the track command */
export interface TrackOptions {
  /** Override the auto-detected project name */
  name?: string;
  /** Path to the project directory (default: CWD) */
  path?: string;
  /** Skip committing/pushing to sync repo */
  noSync?: boolean;
  /** Skip interactive prompts — accept defaults */
  yes?: boolean;
  /** Non-interactive mode — skip all prompts */
  noInteractive?: boolean;
  /** Override wizard prompt function (for testing) */
  wizardPromptFn?: (context: WizardContext) => Promise<WizardAnswers>;
}

/** Context provided to the wizard prompt function */
export interface WizardContext {
  projectName: string;
  projectPath: string;
  gitBranch: string;
  envFileFound: boolean;
  dockerComposeFound: boolean;
  isNew: boolean;
}

/** Answers collected from the wizard */
export interface WizardAnswers {
  /** Whether to import .env file */
  importEnv: boolean;
  /** Whether to track Docker services */
  trackDocker: boolean;
  /** Mental context — current task (empty string = skip) */
  currentTask: string;
  /** Mental context — next steps (empty array = skip) */
  nextSteps: string[];
  /** Whether to proceed with commit */
  confirmCommit: boolean;
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
  /** Number of env vars imported (0 if skipped) */
  envVarsImported: number;
  /** Number of Docker services tracked (0 if skipped) */
  dockerServicesTracked: number;
  /** Whether mental context was set */
  mentalContextSet: boolean;
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
 * Auto-detect project name from Git remote URL or directory name.
 *
 * Priority:
 *   1. Explicit `--name` flag.
 *   2. Repository name from Git remote URL (e.g., `origin`).
 *   3. Directory name.
 *
 * @param projectPath - Absolute path to the project directory.
 * @param gitRemote - The Git remote fetch URL (empty if none).
 * @returns The detected project name.
 */
export function detectProjectName(projectPath: string, gitRemote: string): string {
  // Try to extract repo name from Git remote URL
  if (gitRemote) {
    // SSH format: git@github.com:user/repo-name.git
    const sshMatch = /\/([^/]+?)(?:\.git)?$/.exec(gitRemote);
    if (sshMatch?.[1]) {
      return sshMatch[1];
    }

    // HTTPS format: https://github.com/user/repo-name.git
    const httpsMatch = /\/([^/]+?)(?:\.git)?$/.exec(gitRemote);
    if (httpsMatch?.[1]) {
      return httpsMatch[1];
    }
  }

  // Fall back to directory name
  return path.basename(projectPath);
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
 * Run the interactive wizard to collect user choices.
 *
 * @param context - Information about the detected project state.
 * @returns User's wizard answers.
 */
async function runWizard(context: WizardContext): Promise<WizardAnswers> {
  const Enquirer = (await import('enquirer')).default;
  const enquirer = new Enquirer<Record<string, string>>();

  const answers: WizardAnswers = {
    importEnv: false,
    trackDocker: false,
    currentTask: '',
    nextSteps: [],
    confirmCommit: true,
  };

  // Step 1: Confirm or change project name (already auto-detected)
  // This is shown via console output, not a prompt

  // Step 2: .env import prompt
  if (context.envFileFound) {
    const envResponse = await enquirer.prompt({
      type: 'confirm',
      name: 'importEnv',
      message: 'Found .env file. Import environment variables?',
      initial: true,
    } as Parameters<typeof enquirer.prompt>[0]);
    const envVal = String(envResponse.importEnv ?? '');
    answers.importEnv = envVal === 'true' || envVal.toLowerCase() === 'yes';
  }

  // Step 3: Docker tracking prompt
  if (context.dockerComposeFound) {
    const dockerResponse = await enquirer.prompt({
      type: 'confirm',
      name: 'trackDocker',
      message: 'Found Docker Compose. Track Docker services?',
      initial: true,
    } as Parameters<typeof enquirer.prompt>[0]);
    const dVal = String(dockerResponse.trackDocker ?? '');
    answers.trackDocker = dVal === 'true' || dVal.toLowerCase() === 'yes';
  }

  // Step 4: Mental context — current task
  const taskResponse = await enquirer.prompt({
    type: 'input',
    name: 'currentTask',
    message: 'What are you working on? (press Enter to skip)',
  } as Parameters<typeof enquirer.prompt>[0]);
  if (taskResponse.currentTask?.trim()) {
    answers.currentTask = taskResponse.currentTask.trim();
  }

  // Step 5: Mental context — next steps
  if (answers.currentTask) {
    const stepsResponse = await enquirer.prompt({
      type: 'input',
      name: 'nextSteps',
      message: 'Next steps? (comma-separated, or press Enter to skip)',
    } as Parameters<typeof enquirer.prompt>[0]);
    if (stepsResponse.nextSteps?.trim()) {
      answers.nextSteps = stepsResponse.nextSteps
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
  }

  // Step 6: Summary and confirmation
  answers.confirmCommit = true;

  return answers;
}

/**
 * Execute the track command logic.
 *
 * 1. Resolve and validate the project path.
 * 2. Auto-detect project name from Git remote / directory.
 * 3. Detect Git info, .env, docker-compose.
 * 4. Run interactive wizard (if not --yes or --no-interactive).
 * 5. Build or update the Project entry.
 * 6. Optionally import .env, track Docker, set mental context.
 * 7. Encrypt and write state.age.
 * 8. Optionally commit to the sync repo.
 *
 * @param options - Track command options.
 * @returns Track result including the project entry.
 */
export async function executeTrack(options: TrackOptions): Promise<TrackResult> {
  // 1. Resolve and validate path
  const rawPath = options.path ?? process.cwd();
  const projectPath = validateProjectPath(rawPath);

  // 2. Load key and derive public key
  const configDir = getConfigDir();
  const syncDir = getSyncDir();
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  // 3. Detect Git info
  const gitInfo = await detectGitInfo(projectPath);

  // 4. Auto-detect project name
  const projectName = options.name ?? detectProjectName(projectPath, gitInfo.remote);

  // 5. Check for .env and docker-compose
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

  // 8. Run wizard (unless --yes or --no-interactive)
  let wizardAnswers: WizardAnswers | null = null;
  let envVarsImported = 0;
  let dockerServicesTracked = 0;
  let mentalContextSet = false;

  const isInteractive = !options.yes && !options.noInteractive;
  const autoAcceptAll = options.yes === true;

  if (options.wizardPromptFn) {
    // Testing override
    wizardAnswers = await options.wizardPromptFn({
      projectName,
      projectPath,
      gitBranch: gitInfo.branch,
      envFileFound,
      dockerComposeFound,
      isNew,
    });
  } else if (isInteractive && isNew) {
    // Interactive wizard for new projects only
    wizardAnswers = await runWizard({
      projectName,
      projectPath,
      gitBranch: gitInfo.branch,
      envFileFound,
      dockerComposeFound,
      isNew,
    });
  } else if (autoAcceptAll) {
    // --yes mode: auto-accept .env import and Docker tracking, skip mental context
    wizardAnswers = {
      importEnv: envFileFound,
      trackDocker: dockerComposeFound,
      currentTask: '',
      nextSteps: [],
      confirmCommit: true,
    };
  }

  // 9. Process wizard answers — import .env
  if (wizardAnswers?.importEnv && envFileFound) {
    try {
      const envFilePath = path.join(projectPath, '.env');
      const content = fs.readFileSync(envFilePath, 'utf-8');
      const { parseEnvFile, importEnvVars } = await import('../core/env-handler.js');
      const vars = parseEnvFile(content);
      envVarsImported = await importEnvVars(
        projectName,
        vars,
        syncDir,
        publicKey,
        privateKey,
      );
    } catch {
      // .env import failure is non-fatal
    }
  }

  // 10. Process wizard answers — track Docker
  if (wizardAnswers?.trackDocker && dockerComposeFound) {
    try {
      const { buildDockerStateEntry, saveDockerState } =
        await import('../core/docker-handler.js');
      const entry = buildDockerStateEntry(projectName, projectPath);
      if (entry) {
        await saveDockerState(syncDir, projectName, entry, publicKey, privateKey);
        dockerServicesTracked = entry.services.length;
      }
    } catch {
      // Docker tracking failure is non-fatal
    }
  }

  // 11. Process wizard answers — set mental context
  if (wizardAnswers?.currentTask) {
    try {
      const { mergeContext } = await import('./note.js');
      const existingMentalContext = await readState<MentalContext>(
        syncDir,
        privateKey,
        'mental-context',
      );
      const mcData: MentalContext = existingMentalContext ?? {};
      const existing = mcData[projectName] ?? null;
      const merged = mergeContext(existing, {
        currentTask: wizardAnswers.currentTask,
        nextSteps: wizardAnswers.nextSteps,
      });
      mcData[projectName] = merged;
      await writeState(syncDir, mcData, publicKey, 'mental-context');
      mentalContextSet = true;
    } catch {
      // Mental context failure is non-fatal
    }
  }

  // 12. Write encrypted state
  await writeState(syncDir, state, publicKey, 'state');

  // 13. Collect all files that need committing
  const filesToCommit: string[] = [STATE_FILES.STATE, STATE_FILES.MANIFEST];
  if (envVarsImported > 0) {
    filesToCommit.push(STATE_FILES.ENV_VARS);
  }
  if (dockerServicesTracked > 0) {
    filesToCommit.push(STATE_FILES.DOCKER_STATE);
  }
  if (mentalContextSet) {
    filesToCommit.push(STATE_FILES.MENTAL_CONTEXT);
  }

  // 14. Optionally commit
  if (!options.noSync && (wizardAnswers?.confirmCommit !== false)) {
    await commitState(
      syncDir,
      filesToCommit,
      `feat: ${isNew ? 'track' : 'update'} project ${projectName}`,
    );
  }

  return {
    project,
    isNew,
    envFileFound,
    dockerComposeFound,
    envVarsImported,
    dockerServicesTracked,
    mentalContextSet,
  };
}

/**
 * Register the `track` command on the given Commander program.
 */
export function registerTrackCommand(program: Command): void {
  program
    .command('track')
    .description('Track the current project directory')
    .option('-n, --name <name>', 'Project name (default: auto-detect from Git remote)')
    .option('-p, --path <path>', 'Project path (default: current directory)')
    .option('--no-sync', 'Skip syncing to Git after tracking')
    .option('-y, --yes', 'Accept all defaults without prompting')
    .option('--no-interactive', 'Skip all interactive prompts')
    .action(withErrorHandler(async (opts: Record<string, unknown>) => {
      const options: TrackOptions = {
        name: opts['name'] as string | undefined,
        path: opts['path'] as string | undefined,
        noSync: opts['sync'] === false,
        yes: opts['yes'] as boolean | undefined,
        noInteractive: opts['interactive'] === false,
      };

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

      // Wizard results
      if (result.envVarsImported > 0) {
        console.log(
          chalk.green(`   ✅ Imported ${result.envVarsImported} env vars (all encrypted)`),
        );
      } else if (result.envFileFound) {
        console.log(
          chalk.cyan(
            '   ℹ .env file found — use `ctx-sync env import` to track environment variables',
          ),
        );
      }

      if (result.dockerServicesTracked > 0) {
        console.log(
          chalk.green(`   ✅ Tracking ${result.dockerServicesTracked} Docker service(s)`),
        );
      } else if (result.dockerComposeFound) {
        console.log(
          chalk.cyan(
            '   ℹ Docker Compose found — use `ctx-sync docker track` to track services',
          ),
        );
      }

      if (result.mentalContextSet) {
        console.log(chalk.green('   ✅ Mental context saved'));
      }

      console.log(
        chalk.dim('\n   State encrypted and saved to state.age'),
      );
    }));
}
