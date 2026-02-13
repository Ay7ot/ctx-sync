/**
 * `ctx-sync note <project>` command.
 *
 * Records and updates mental context for a project — the "23-minute
 * problem" solution. Prompts the user for current task, blockers,
 * next steps, related links, and breadcrumbs, then encrypts and
 * stores them in `mental-context.age`.
 *
 * Supports both interactive (prompt-based) and non-interactive
 * (flag-based) input modes. When updating, existing context is
 * merged — not overwritten — so incremental notes accumulate.
 *
 * @module commands/note
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import type {
  StateFile,
  MentalContext,
  ProjectMentalContext,
  RelatedLink,
} from '@ctx-sync/shared';
import { STATE_FILES } from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { loadKey } from '../core/key-store.js';
import { readState, writeState } from '../core/state-manager.js';
import { commitState } from '../core/git-sync.js';
import { getConfigDir, getSyncDir } from './init.js';

/** Options for the note command */
export interface NoteOptions {
  /** The current task description */
  task?: string;
  /** Blockers (comma-separated or repeated flag) */
  blockers?: string[];
  /** Next steps (comma-separated or repeated flag) */
  nextSteps?: string[];
  /** Related links (comma-separated) */
  links?: string[];
  /** Breadcrumb note */
  breadcrumb?: string;
  /** File being worked on (format: file:line or file:line:col) */
  file?: string;
  /** Description of what's being done at the file location */
  fileDescription?: string;
  /** Non-interactive mode: skip prompts, use flags only */
  noInteractive?: boolean;
  /** Skip committing/pushing to sync repo */
  noSync?: boolean;
  /** Override prompt function (for testing) */
  promptFn?: (existing: ProjectMentalContext | null) => Promise<NoteInput>;
}

/** Raw input collected from prompts or flags */
export interface NoteInput {
  currentTask?: string;
  blockers?: string[];
  nextSteps?: string[];
  relatedLinks?: Array<{ title: string; url: string }>;
  breadcrumb?: string;
  lastWorkingOn?: {
    file: string;
    line: number;
    column?: number;
    description: string;
  };
}

/** Result of the note command */
export interface NoteResult {
  /** Name of the project */
  projectName: string;
  /** Whether a new mental context was created (vs. update) */
  isNew: boolean;
  /** The final merged mental context */
  context: ProjectMentalContext;
}

/**
 * Parse a file reference string into structured location data.
 *
 * Accepts formats:
 *   - `file.ts`           → { file: 'file.ts', line: 0 }
 *   - `file.ts:45`        → { file: 'file.ts', line: 45 }
 *   - `file.ts:45:12`     → { file: 'file.ts', line: 45, column: 12 }
 *
 * @param fileRef - The file reference string.
 * @returns Parsed location, or null if the string is empty.
 */
export function parseFileReference(
  fileRef: string,
): { file: string; line: number; column?: number } | null {
  const trimmed = fileRef.trim();
  if (!trimmed) {
    return null;
  }

  // Match file:line:col or file:line or just file
  const match = /^(.+?)(?::(\d+))?(?::(\d+))?$/.exec(trimmed);
  if (!match?.[1]) {
    return null;
  }

  const file = match[1];
  const line = match[2] ? parseInt(match[2], 10) : 0;
  const column = match[3] ? parseInt(match[3], 10) : undefined;

  return { file, line, column };
}

/**
 * Parse a link string into title and URL.
 *
 * Accepts formats:
 *   - `https://example.com`            → { title: 'https://example.com', url: 'https://example.com' }
 *   - `Title: https://example.com`     → { title: 'Title', url: 'https://example.com' }
 *   - `Title - https://example.com`    → { title: 'Title', url: 'https://example.com' }
 *
 * @param linkStr - The link string.
 * @returns Parsed link with title and URL.
 */
export function parseLink(linkStr: string): RelatedLink {
  const trimmed = linkStr.trim();

  // Try "Title: URL" or "Title - URL" format
  const separatorMatch = /^(.+?)\s*[-:]\s*(https?:\/\/.+)$/i.exec(trimmed);
  if (separatorMatch?.[1] && separatorMatch[2]) {
    return { title: separatorMatch[1].trim(), url: separatorMatch[2].trim() };
  }

  // Just a URL — use it as both title and URL
  return { title: trimmed, url: trimmed };
}

/**
 * Create a default empty mental context structure.
 *
 * @returns A blank ProjectMentalContext.
 */
export function createEmptyContext(): ProjectMentalContext {
  return {
    currentTask: '',
    blockers: [],
    nextSteps: [],
    relatedLinks: [],
    breadcrumbs: [],
  };
}

/**
 * Merge new input into an existing mental context.
 *
 * Follows merge-not-overwrite semantics:
 *   - `currentTask` is replaced if new input provides one.
 *   - `lastWorkingOn` is replaced if new input provides one.
 *   - Blockers, next steps, links, and breadcrumbs are appended.
 *   - Duplicate blockers (by description) are skipped.
 *   - Duplicate links (by URL) are skipped.
 *
 * @param existing - The existing mental context (or null for new).
 * @param input - The new input to merge.
 * @returns The merged context.
 */
export function mergeContext(
  existing: ProjectMentalContext | null,
  input: NoteInput,
): ProjectMentalContext {
  const base = existing ?? createEmptyContext();
  const now = new Date().toISOString();

  const merged: ProjectMentalContext = {
    currentTask: input.currentTask?.trim() || base.currentTask,
    lastWorkingOn: base.lastWorkingOn,
    blockers: [...base.blockers],
    nextSteps: [...base.nextSteps],
    relatedLinks: [...base.relatedLinks],
    breadcrumbs: [...base.breadcrumbs],
  };

  // Update lastWorkingOn if provided
  if (input.lastWorkingOn) {
    merged.lastWorkingOn = {
      file: input.lastWorkingOn.file,
      line: input.lastWorkingOn.line,
      column: input.lastWorkingOn.column,
      description: input.lastWorkingOn.description || '',
      timestamp: now,
    };
  }

  // Append new blockers (skip duplicates by description)
  if (input.blockers) {
    const existingDescriptions = new Set(
      merged.blockers.map((b) => b.description.toLowerCase()),
    );
    for (const desc of input.blockers) {
      const trimmed = desc.trim();
      if (trimmed && !existingDescriptions.has(trimmed.toLowerCase())) {
        merged.blockers.push({
          description: trimmed,
          addedAt: now,
          priority: 'medium',
        });
        existingDescriptions.add(trimmed.toLowerCase());
      }
    }
  }

  // Append new next steps (skip exact duplicates)
  if (input.nextSteps) {
    const existingSteps = new Set(merged.nextSteps.map((s) => s.toLowerCase()));
    for (const step of input.nextSteps) {
      const trimmed = step.trim();
      if (trimmed && !existingSteps.has(trimmed.toLowerCase())) {
        merged.nextSteps.push(trimmed);
        existingSteps.add(trimmed.toLowerCase());
      }
    }
  }

  // Append new related links (skip duplicates by URL)
  if (input.relatedLinks) {
    const existingUrls = new Set(merged.relatedLinks.map((l) => l.url));
    for (const link of input.relatedLinks) {
      if (link.url.trim() && !existingUrls.has(link.url.trim())) {
        merged.relatedLinks.push({
          title: link.title.trim(),
          url: link.url.trim(),
        });
        existingUrls.add(link.url.trim());
      }
    }
  }

  // Append breadcrumb if provided
  if (input.breadcrumb?.trim()) {
    merged.breadcrumbs.push({
      note: input.breadcrumb.trim(),
      timestamp: now,
    });
  }

  return merged;
}

/**
 * Collect note input from interactive prompts.
 *
 * Shows the user their existing mental context (if any) and prompts
 * for updates. Empty responses keep the existing values.
 *
 * @param existing - The existing mental context (or null).
 * @returns The collected input.
 */
export async function collectNoteInput(
  existing: ProjectMentalContext | null,
): Promise<NoteInput> {
  const Enquirer = (await import('enquirer')).default;
  const enquirer = new Enquirer<Record<string, string>>();

  const input: NoteInput = {};

  // Show existing context summary if available
  if (existing?.currentTask) {
    const chalk = (await import('chalk')).default;
    console.log(chalk.dim(`\nCurrent task: "${existing.currentTask}"`));
    if (existing.blockers.length > 0) {
      console.log(chalk.dim(`Blockers: ${existing.blockers.map((b) => b.description).join(', ')}`));
    }
    if (existing.nextSteps.length > 0) {
      console.log(chalk.dim(`Next steps: ${existing.nextSteps.join(', ')}`));
    }
    console.log('');
  }

  // Current task
  const taskResponse = await enquirer.prompt({
    type: 'input',
    name: 'currentTask',
    message: 'Current task:',
    initial: existing?.currentTask ?? '',
  } as Parameters<typeof enquirer.prompt>[0]);
  if (taskResponse.currentTask?.trim()) {
    input.currentTask = taskResponse.currentTask;
  }

  // Blockers
  const blockerResponse = await enquirer.prompt({
    type: 'input',
    name: 'blockers',
    message: 'Blockers (comma-separated, or press Enter to skip):',
  } as Parameters<typeof enquirer.prompt>[0]);
  if (blockerResponse.blockers?.trim()) {
    input.blockers = blockerResponse.blockers
      .split(',')
      .map((b: string) => b.trim())
      .filter(Boolean);
  }

  // Next steps
  const stepsResponse = await enquirer.prompt({
    type: 'input',
    name: 'nextSteps',
    message: 'Next steps (comma-separated, or press Enter to skip):',
  } as Parameters<typeof enquirer.prompt>[0]);
  if (stepsResponse.nextSteps?.trim()) {
    input.nextSteps = stepsResponse.nextSteps
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
  }

  // Related links
  const linksResponse = await enquirer.prompt({
    type: 'input',
    name: 'links',
    message: 'Related links (comma-separated, or press Enter to skip):',
  } as Parameters<typeof enquirer.prompt>[0]);
  if (linksResponse.links?.trim()) {
    input.relatedLinks = linksResponse.links
      .split(',')
      .map((l: string) => parseLink(l.trim()))
      .filter((l: RelatedLink) => l.url);
  }

  // Breadcrumb
  const breadcrumbResponse = await enquirer.prompt({
    type: 'input',
    name: 'breadcrumb',
    message: 'Breadcrumb note (or press Enter to skip):',
  } as Parameters<typeof enquirer.prompt>[0]);
  if (breadcrumbResponse.breadcrumb?.trim()) {
    input.breadcrumb = breadcrumbResponse.breadcrumb;
  }

  return input;
}

/**
 * Build NoteInput from CLI flags (non-interactive mode).
 *
 * @param options - The command-line options.
 * @returns The constructed note input.
 */
export function buildInputFromFlags(options: NoteOptions): NoteInput {
  const input: NoteInput = {};

  if (options.task) {
    input.currentTask = options.task;
  }

  if (options.blockers && options.blockers.length > 0) {
    input.blockers = options.blockers;
  }

  if (options.nextSteps && options.nextSteps.length > 0) {
    input.nextSteps = options.nextSteps;
  }

  if (options.links && options.links.length > 0) {
    input.relatedLinks = options.links.map((l) => parseLink(l));
  }

  if (options.breadcrumb) {
    input.breadcrumb = options.breadcrumb;
  }

  if (options.file) {
    const parsed = parseFileReference(options.file);
    if (parsed) {
      input.lastWorkingOn = {
        file: parsed.file,
        line: parsed.line,
        column: parsed.column,
        description: options.fileDescription ?? '',
      };
    }
  }

  return input;
}

/**
 * Execute the note command logic.
 *
 * 1. Load key and decrypt existing state to find the project.
 * 2. Load existing mental context (if any).
 * 3. Collect new input (interactive prompts or flags).
 * 4. Merge new input into existing context.
 * 5. Encrypt and write `mental-context.age`.
 * 6. Optionally commit to the sync repo.
 *
 * @param projectName - The name of the project.
 * @param options - Note command options.
 * @returns The note result.
 */
export async function executeNote(
  projectName: string,
  options: NoteOptions = {},
): Promise<NoteResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // Verify sync dir exists
  if (!fs.existsSync(syncDir) || !fs.existsSync(path.join(syncDir, '.git'))) {
    throw new Error('No sync repository found. Run `ctx-sync init` first.');
  }

  // Load key
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  // 1. Verify the project exists in state
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

  // 2. Load existing mental context
  const mentalContextData = await readState<MentalContext>(
    syncDir,
    privateKey,
    'mental-context',
  );
  const existingContext = mentalContextData?.[project.name] ?? null;
  const isNew = existingContext === null;

  // 3. Collect input
  let noteInput: NoteInput;

  if (options.promptFn) {
    // Testing override
    noteInput = await options.promptFn(existingContext);
  } else if (options.noInteractive) {
    // Non-interactive: use flags only
    noteInput = buildInputFromFlags(options);
  } else {
    // Interactive: prompt user
    noteInput = await collectNoteInput(existingContext);
  }

  // 4. Merge input into existing context
  const mergedContext = mergeContext(existingContext, noteInput);

  // 5. Write encrypted mental-context.age
  const allMentalContext: MentalContext = mentalContextData ?? {};
  allMentalContext[project.name] = mergedContext;

  await writeState(syncDir, allMentalContext, publicKey, 'mental-context');

  // 6. Optionally commit
  if (!options.noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.MENTAL_CONTEXT, STATE_FILES.MANIFEST],
      `feat: update mental context for ${project.name}`,
    );
  }

  return {
    projectName: project.name,
    isNew,
    context: mergedContext,
  };
}

/**
 * Register the `note` command on the given Commander program.
 */
export function registerNoteCommand(program: Command): void {
  program
    .command('note <project>')
    .description('Record mental context for a project (tasks, blockers, next steps)')
    .option('-t, --task <task>', 'Current task description')
    .option('-b, --blocker <blocker...>', 'Add blocker(s)')
    .option('-s, --next-step <step...>', 'Add next step(s)')
    .option('-l, --link <link...>', 'Add related link(s)')
    .option('-c, --breadcrumb <note>', 'Add a breadcrumb note')
    .option('-f, --file <file>', 'File being worked on (file:line:col)')
    .option('--file-description <desc>', 'Description of file work')
    .option('--no-interactive', 'Use flags only, skip prompts')
    .option('--no-sync', 'Skip syncing to Git')
    .action(withErrorHandler(async (projectName: string, opts: Record<string, unknown>) => {
      const options: NoteOptions = {
        task: opts['task'] as string | undefined,
        blockers: opts['blocker'] as string[] | undefined,
        nextSteps: opts['nextStep'] as string[] | undefined,
        links: opts['link'] as string[] | undefined,
        breadcrumb: opts['breadcrumb'] as string | undefined,
        file: opts['file'] as string | undefined,
        fileDescription: opts['fileDescription'] as string | undefined,
        noInteractive: opts['interactive'] === false,
        noSync: opts['sync'] === false,
      };

      const chalk = (await import('chalk')).default;

      const result = await executeNote(projectName, options);

      if (result.isNew) {
        console.log(chalk.green(`✅ Mental context created for: ${result.projectName}`));
      } else {
        console.log(chalk.green(`✅ Mental context updated for: ${result.projectName}`));
      }

      if (result.context.currentTask) {
        console.log(`   Task: ${result.context.currentTask}`);
      }

      if (result.context.blockers.length > 0) {
        console.log(`   Blockers: ${result.context.blockers.length}`);
      }

      if (result.context.nextSteps.length > 0) {
        console.log(`   Next steps: ${result.context.nextSteps.length}`);
      }

      if (result.context.relatedLinks.length > 0) {
        console.log(`   Links: ${result.context.relatedLinks.length}`);
      }

      if (result.context.breadcrumbs.length > 0) {
        console.log(`   Breadcrumbs: ${result.context.breadcrumbs.length}`);
      }

      console.log(chalk.dim('\n   Context encrypted and saved to mental-context.age'));
    }));
}
