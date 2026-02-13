/**
 * `ctx-sync env` command group.
 *
 * Subcommands:
 *   - `env import <project> <file>` — Import from .env file
 *   - `env add <project> <key>` — Add single var (hidden input / stdin)
 *   - `env scan <project>` — Scan current shell environment
 *   - `env list <project>` — List env vars (values hidden by default)
 *
 * Security:
 *   - Secret values are NEVER accepted as CLI arguments.
 *   - All env vars encrypted by default (encrypt-by-default).
 *   - Values are never displayed in CLI output unless --show-values.
 *
 * @module commands/env
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import { STATE_FILES, DEFAULT_SAFE_LIST } from '@ctx-sync/shared';
import { identityToRecipient } from 'age-encryption';
import { loadKey } from '../core/key-store.js';
import { commitState } from '../core/git-sync.js';
import { getConfigDir, getSyncDir } from './init.js';
import type { ListedEnvVar } from '../core/env-handler.js';
import {
  parseEnvFile,
  importEnvVars,
  addEnvVar,
  listEnvVars,
  validateKeyArg,
  readValueFromStdin,
  shouldEncrypt,
} from '../core/env-handler.js';

/**
 * Options for the env import command.
 */
export interface EnvImportOptions {
  project: string;
  file?: string;
  stdin?: boolean;
  allowPlain?: boolean;
  noSync?: boolean;
}

/**
 * Result of env import.
 */
export interface EnvImportResult {
  importedCount: number;
  encryptedCount: number;
  plainCount: number;
}

/**
 * Execute env import from a file or stdin.
 */
export async function executeEnvImport(
  options: EnvImportOptions,
): Promise<EnvImportResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  let content: string;

  if (options.stdin) {
    content = await readValueFromStdin();
  } else if (options.file) {
    const filePath = path.resolve(options.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    content = fs.readFileSync(filePath, 'utf-8');
  } else {
    throw new Error(
      'Provide a file path or use --stdin.\n' +
        'Usage: ctx-sync env import <project> <file>\n' +
        '       cat .env | ctx-sync env import <project> --stdin',
    );
  }

  const parsed = parseEnvFile(content);

  if (parsed.length === 0) {
    throw new Error('No environment variables found in input.');
  }

  // Count how many would be encrypted vs plain (informational)
  let encryptedCount = 0;
  let plainCount = 0;

  for (const { key, value } of parsed) {
    if (shouldEncrypt(key, value)) {
      encryptedCount++;
    } else if (options.allowPlain) {
      plainCount++;
    } else {
      // Without --allow-plain, everything is encrypted
      encryptedCount++;
    }
  }

  // Import all vars (entire .age file is encrypted regardless)
  const importedCount = await importEnvVars(
    options.project,
    parsed,
    syncDir,
    publicKey,
    privateKey,
  );

  // Commit
  if (!options.noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.ENV_VARS, STATE_FILES.MANIFEST],
      `feat: import ${importedCount} env vars for ${options.project}`,
    );
  }

  return { importedCount, encryptedCount, plainCount };
}

/**
 * Options for the env add command.
 */
export interface EnvAddOptions {
  project: string;
  key: string;
  stdin?: boolean;
  fromFd?: number;
  noSync?: boolean;
}

/**
 * Execute env add (single variable).
 */
export async function executeEnvAdd(
  options: EnvAddOptions & { value?: string },
): Promise<void> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  // Validate key does not contain embedded value
  validateKeyArg(options.key);

  let value: string;

  if (options.value !== undefined) {
    // Value provided programmatically (from hidden prompt or stdin)
    value = options.value;
  } else if (options.stdin) {
    value = await readValueFromStdin();
  } else {
    throw new Error(
      'A value is required.\n' +
        'Use interactive prompt or --stdin to provide the value securely.',
    );
  }

  await addEnvVar(
    options.project,
    options.key,
    value,
    syncDir,
    publicKey,
    privateKey,
  );

  // Commit
  if (!options.noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.ENV_VARS, STATE_FILES.MANIFEST],
      `feat: add env var ${options.key} for ${options.project}`,
    );
  }
}

/**
 * Options for env scan.
 */
export interface EnvScanOptions {
  project: string;
  noSync?: boolean;
}

/** A candidate env var from the current shell */
export interface EnvScanCandidate {
  key: string;
  value: string;
  isProjectRelated: boolean;
}

/**
 * Scan the current shell environment for project-related variables.
 *
 * Heuristic: exclude common system vars and PATH-like variables.
 * Returns candidates for user to select from.
 */
export function scanEnvironment(): EnvScanCandidate[] {
  const systemVars = new Set([
    'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM',
    'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'DISPLAY', 'HOSTNAME', 'OLDPWD', 'PWD', 'SHLVL',
    'COLORTERM', '_', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
    'TERM_SESSION_ID', 'XPC_FLAGS', 'XPC_SERVICE_NAME',
    'APPLE_TERMINAL_PROCESS_ID', 'SSH_AUTH_SOCK',
    'SECURITYSESSIONID', 'LaunchInstanceID', 'ITERM_SESSION_ID',
    'ITERM_PROFILE', 'COLORFGBG', 'ORIGINAL_XDG_CURRENT_DESKTOP',
    'MallocNanoZone', '__CF_USER_TEXT_ENCODING', '__CFBundleIdentifier',
    'COMMAND_MODE',
    // Node/npm specific
    'NVM_DIR', 'NVM_BIN', 'NVM_INC', 'NVM_CD_FLAGS',
    'NODE_PATH', 'npm_config_prefix',
    // Test environment
    'CTX_SYNC_HOME', 'CTX_SYNC_TEST_MODE',
    'GIT_TERMINAL_PROMPT',
  ]);

  const candidates: EnvScanCandidate[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    if (systemVars.has(key)) continue;
    // Skip PATH-like vars (contain multiple colon-separated paths)
    if (value.includes(':') && value.includes('/') && value.split(':').length > 2) continue;

    // Heuristic: project-related if it looks like an app config var
    const isProjectRelated =
      key.includes('_KEY') ||
      key.includes('_SECRET') ||
      key.includes('_TOKEN') ||
      key.includes('_URL') ||
      key.includes('_HOST') ||
      key.includes('_PORT') ||
      key.includes('_ENV') ||
      key.includes('DATABASE') ||
      key.includes('REDIS') ||
      key.includes('API') ||
      key.includes('AWS') ||
      key.includes('STRIPE') ||
      DEFAULT_SAFE_LIST.includes(key);

    candidates.push({ key, value, isProjectRelated });
  }

  return candidates.sort((a, b) => {
    // Project-related first, then alphabetical
    if (a.isProjectRelated && !b.isProjectRelated) return -1;
    if (!a.isProjectRelated && b.isProjectRelated) return 1;
    return a.key.localeCompare(b.key);
  });
}

/**
 * Execute env scan — import selected vars from current environment.
 */
export async function executeEnvScan(
  options: EnvScanOptions,
  selectedKeys: string[],
): Promise<number> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);

  const vars = selectedKeys
    .map((key) => ({
      key,
      value: process.env[key] ?? '',
    }))
    .filter((v) => v.value !== '');

  if (vars.length === 0) {
    return 0;
  }

  const count = await importEnvVars(
    options.project,
    vars,
    syncDir,
    publicKey,
    privateKey,
  );

  // Commit
  if (!options.noSync) {
    await commitState(
      syncDir,
      [STATE_FILES.ENV_VARS, STATE_FILES.MANIFEST],
      `feat: scan ${count} env vars for ${options.project}`,
    );
  }

  return count;
}

/**
 * Options for env list.
 */
export interface EnvListOptions {
  project: string;
  showValues?: boolean;
}

/**
 * Execute env list.
 */
export async function executeEnvList(options: EnvListOptions): Promise<ListedEnvVar[]> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();
  const privateKey = loadKey(configDir);

  return listEnvVars(
    options.project,
    syncDir,
    privateKey,
    options.showValues ?? false,
  );
}

/**
 * Register the `env` command group on the given Commander program.
 */
export function registerEnvCommand(program: Command): void {
  const env = program
    .command('env')
    .description('Manage environment variables (encrypted by default)');

  // --- env import ---
  env
    .command('import <project> [file]')
    .description('Import environment variables from a .env file')
    .option('--stdin', 'Read .env content from stdin')
    .option('--allow-plain', 'Store safe-listed keys as plaintext (not recommended)')
    .option('--no-sync', 'Skip syncing to Git after import')
    .action(withErrorHandler(async (project: string, file: string | undefined, opts: Record<string, unknown>) => {
      const options: EnvImportOptions = {
          project,
          file,
          stdin: opts['stdin'] as boolean | undefined,
          allowPlain: opts['allowPlain'] as boolean | undefined,
          noSync: opts['sync'] === false,
        };

        const result = await executeEnvImport(options);

        const chalk = (await import('chalk')).default;
        console.log(
          chalk.green(`✅ Imported ${result.importedCount} env vars`) +
            ` for ${project}`,
        );
        console.log(
          chalk.dim(`   🔐 All ${result.importedCount} encrypted (encrypt-by-default)`),
        );

        if (result.plainCount > 0) {
          console.log(
            chalk.dim(
              `   💡 ${result.plainCount} on safe-list (still encrypted at file level)`,
            ),
          );
        }

        console.log(chalk.dim('\n   State encrypted and saved to env-vars.age'));
    }));

  // --- env add ---
  env
    .command('add <project> <key>')
    .description('Add a single environment variable (secure input)')
    .option('--stdin', 'Read value from stdin')
    .option('--from-fd <fd>', 'Read value from file descriptor')
    .option('--no-sync', 'Skip syncing to Git')
    .action(withErrorHandler(async (project: string, key: string, opts: Record<string, unknown>) => {
      const addOptions: EnvAddOptions & { value?: string } = {
          project,
          key,
          stdin: opts['stdin'] as boolean | undefined,
          fromFd: opts['fromFd'] !== undefined ? Number(opts['fromFd']) : undefined,
          noSync: opts['sync'] === false,
        };

        // Validate key does not contain embedded value (security check)
        validateKeyArg(key);

        if (addOptions.stdin) {
          // Read from stdin
          addOptions.value = await readValueFromStdin();
        } else if (addOptions.fromFd !== undefined) {
          // Read from file descriptor
          try {
            const fd = fs.openSync(`/dev/fd/${addOptions.fromFd}`, 'r');
            const buffer = Buffer.alloc(65536);
            const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
            fs.closeSync(fd);
            addOptions.value = buffer.slice(0, bytesRead).toString('utf-8').trim();
          } catch {
            throw new Error(
              `Failed to read from file descriptor ${addOptions.fromFd}.\n` +
                `Usage: ctx-sync env add ${project} ${key} --from-fd 3 3< <(pass show key)`,
            );
          }
        } else {
          // Interactive prompt with hidden input
          const Enquirer = (await import('enquirer')).default;
          const enquirer = new Enquirer<{ value: string }>();
          const response = await enquirer.prompt({
            type: 'password',
            name: 'value',
            message: `Enter value for ${key}:`,
          });
          addOptions.value = response.value;
        }

        await executeEnvAdd(addOptions);

        const chalk = (await import('chalk')).default;
        console.log(chalk.green(`✅ Added ${key}`) + ` for ${project}`);
        console.log(chalk.dim('   🔐 Encrypted and saved'));
    }));

  // --- env scan ---
  env
    .command('scan <project>')
    .description('Scan current shell environment for project-related variables')
    .option('--no-sync', 'Skip syncing to Git')
    .action(withErrorHandler(async (project: string, opts: Record<string, unknown>) => {
      const candidates = scanEnvironment();

        if (candidates.length === 0) {
          console.log('No environment variables found to scan.');
          return;
        }

        const projectRelated = candidates.filter((c) => c.isProjectRelated);

        const chalk = (await import('chalk')).default;
        console.log(
          chalk.bold(`Found ${candidates.length} env vars. `) +
            chalk.dim(`(${projectRelated.length} appear project-related)`),
        );

        // In non-interactive mode, import project-related vars
        const isNonInteractive = process.env['CTX_SYNC_TEST_MODE'] === 'true';
        let selectedKeys: string[];

        if (isNonInteractive) {
          selectedKeys = projectRelated.map((c) => c.key);
        } else {
          // Interactive selection
          const Enquirer = (await import('enquirer')).default;
          const enquirer = new Enquirer<{ selectedKeys: string[] }>();
          const response = await enquirer.prompt({
            type: 'multiselect',
            name: 'selectedKeys',
            message: 'Select variables to import:',
            choices: candidates.map((c) => ({
              name: c.key,
              value: c.key,
              hint: c.isProjectRelated ? '(project-related)' : '',
            })),
            initial: projectRelated.map((c) => c.key),
          } as Parameters<typeof enquirer.prompt>[0]);
          selectedKeys = response.selectedKeys;
        }

        if (selectedKeys.length === 0) {
          console.log('No variables selected.');
          return;
        }

        const count = await executeEnvScan(
          { project, noSync: opts['sync'] === false },
          selectedKeys,
        );

        console.log(
          chalk.green(`✅ Imported ${count} env vars`) + ` for ${project}`,
        );
        console.log(chalk.dim('   🔐 All encrypted (encrypt-by-default)'));
    }));

  // --- env list ---
  env
    .command('list <project>')
    .description('List environment variables for a project')
    .option('--show-values', 'Show decrypted values (use with caution)')
    .action(withErrorHandler(async (project: string, opts: Record<string, unknown>) => {
      const showValues = opts['showValues'] as boolean | undefined;
        const vars = await executeEnvList({ project, showValues });

        if (vars.length === 0) {
          console.log(`No environment variables for project "${project}".`);
          console.log('\nImport from a .env file:');
          console.log(`  $ ctx-sync env import ${project} .env`);
          return;
        }

        const chalk = (await import('chalk')).default;

        if (showValues) {
          console.log(
            chalk.yellow('⚠️  Showing decrypted values — be careful with screen sharing!\n'),
          );
        }

        console.log(
          chalk.bold(`Environment variables for ${project} (${vars.length}):\n`),
        );

        for (const v of vars) {
          const added = new Date(v.addedAt);
          console.log(`  ${chalk.cyan(v.key)} = ${v.value}`);
          console.log(
            chalk.dim(`     Added: ${added.toLocaleDateString()} ${added.toLocaleTimeString()}`),
          );
        }
    }));
}
