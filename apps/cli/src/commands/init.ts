/**
 * `ctx-sync init` command.
 *
 * Handles first-time setup (key generation, Git repo init, remote config)
 * and `--restore` flow (key restoration, repo clone, state decryption).
 *
 * @module commands/init
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Command } from 'commander';
import { VERSION, SYNC_DIR, CONFIG_DIR, STATE_FILES } from '@ctx-sync/shared';
import type { Manifest } from '@ctx-sync/shared';
import { generateKey } from '../core/encryption.js';
import { decryptState } from '../core/encryption.js';
import { saveKey, loadKey } from '../core/key-store.js';
import { initRepo, addRemote, commitState, pushState } from '../core/git-sync.js';
import { validateRemoteUrl } from '../core/transport.js';
import { withErrorHandler } from '../utils/errors.js';

/** Options for the init command */
export interface InitOptions {
  restore?: boolean;
  noInteractive?: boolean;
  skipBackup?: boolean;
  remote?: string;
  stdin?: boolean;
}

/** Result of a fresh init */
export interface InitResult {
  publicKey: string;
  configDir: string;
  syncDir: string;
  remoteUrl?: string;
  manifestCreated: boolean;
}

/** Result of a restore init */
export interface RestoreResult {
  configDir: string;
  syncDir: string;
  remoteUrl?: string;
  projectCount: number;
  projectNames: string[];
}

/**
 * Get the config directory path.
 * Uses CTX_SYNC_HOME env var for testing, otherwise ~/.config/ctx-sync.
 */
export function getConfigDir(): string {
  const home = process.env['CTX_SYNC_HOME'] ?? os.homedir();
  return path.join(home, '.config', CONFIG_DIR);
}

/**
 * Get the sync directory path.
 * Uses CTX_SYNC_HOME env var for testing, otherwise ~/.context-sync.
 */
export function getSyncDir(): string {
  const home = process.env['CTX_SYNC_HOME'] ?? os.homedir();
  return path.join(home, SYNC_DIR);
}

/**
 * Create the initial manifest.json in the sync directory.
 *
 * The manifest is the only plaintext file in the sync repo.
 * It contains only version and timestamps — no sensitive data.
 */
export function createManifest(syncDir: string): Manifest {
  const now = new Date().toISOString();
  const manifest: Manifest = {
    version: VERSION,
    lastSync: now,
    files: {},
  };

  fs.writeFileSync(path.join(syncDir, STATE_FILES.MANIFEST), JSON.stringify(manifest, null, 2));

  return manifest;
}

/**
 * Execute the fresh init flow.
 *
 * 1. Generate Age key pair.
 * 2. Save private key to config dir (0o600).
 * 3. Display public key.
 * 4. Handle backup (skip in --no-interactive).
 * 5. Prompt for Git remote URL (or use --remote).
 * 6. Validate remote URL.
 * 7. Initialize sync Git repo.
 * 8. Add remote.
 * 9. Create manifest.json.
 * 10. Commit and push.
 */
export async function executeInit(options: InitOptions): Promise<InitResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // 1. Generate key pair
  const { publicKey, privateKey } = await generateKey();

  // 2. Save private key
  saveKey(configDir, privateKey);

  // 3-4. Display key info (handled by CLI output in registerInitCommand)

  // 5-6. Remote URL
  let remoteUrl: string | undefined;
  if (options.remote) {
    validateRemoteUrl(options.remote);
    remoteUrl = options.remote;
  } else if (!options.noInteractive) {
    const Enquirer = (await import('enquirer')).default;
    const enquirer = new Enquirer<{ remoteUrl: string }>();
    const response = await enquirer.prompt({
      type: 'input',
      name: 'remoteUrl',
      message: 'Git remote URL for syncing (press Enter to skip):',
    } as Parameters<typeof enquirer.prompt>[0]);
    if (response.remoteUrl.trim()) {
      validateRemoteUrl(response.remoteUrl.trim());
      remoteUrl = response.remoteUrl.trim();
    }
  }

  // 7. Init sync repo
  await initRepo(syncDir);

  // 8. Add remote if provided
  if (remoteUrl) {
    await addRemote(syncDir, remoteUrl);
  }

  // 9. Create manifest
  createManifest(syncDir);

  // 10. Commit and push
  await commitState(syncDir, [STATE_FILES.MANIFEST], 'chore: initialize context sync');

  if (remoteUrl) {
    try {
      await pushState(syncDir);
    } catch {
      // Push failure is non-fatal — remote may be unreachable during init.
      // User can push later via `ctx-sync sync`.
    }
  }

  return {
    publicKey,
    configDir,
    syncDir,
    remoteUrl,
    manifestCreated: true,
  };
}

/**
 * Execute the restore flow.
 *
 * 1. Accept private key (from --stdin or prompt).
 * 2. Save key with 0o600 permissions.
 * 3. Prompt for Git remote URL (or use --remote).
 * 4. Validate remote URL.
 * 5. Clone the sync repo to ~/.context-sync/.
 * 6. Decrypt manifest, list found projects.
 * 7. Print summary.
 */
export async function executeRestore(
  options: InitOptions & { key?: string },
): Promise<RestoreResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // 1-2. Save provided key
  if (!options.key) {
    throw new Error(
      'Private key is required for restore.\n' +
        'Use --stdin to pipe the key, or run without --no-interactive for a prompt.',
    );
  }

  // Validate key format
  const trimmedKey = options.key.trim();
  if (!trimmedKey.startsWith('AGE-SECRET-KEY-')) {
    throw new Error(
      'Invalid private key format. Expected key starting with AGE-SECRET-KEY-.\n' +
        'Check your backup and try again.',
    );
  }

  saveKey(configDir, trimmedKey);

  // 3-4. Remote URL
  let remoteUrl: string | undefined;
  if (options.remote) {
    validateRemoteUrl(options.remote);
    remoteUrl = options.remote;
  } else if (!options.noInteractive) {
    const Enquirer = (await import('enquirer')).default;
    const enquirer = new Enquirer<{ remoteUrl: string }>();
    const response = await enquirer.prompt({
      type: 'input',
      name: 'remoteUrl',
      message: 'Git remote URL to clone from (press Enter to skip):',
    } as Parameters<typeof enquirer.prompt>[0]);
    if (response.remoteUrl.trim()) {
      validateRemoteUrl(response.remoteUrl.trim());
      remoteUrl = response.remoteUrl.trim();
    }
  }

  // 5. Clone or init repo
  if (remoteUrl) {
    // Clone via simple-git
    const { simpleGit } = await import('simple-git');
    const git = simpleGit();
    await git.clone(remoteUrl, syncDir);
  } else {
    // Just init locally (no remote to clone from)
    await initRepo(syncDir);
  }

  // 6. Try to decrypt state and list projects
  let projectCount = 0;
  const projectNames: string[] = [];

  const stateFile = path.join(syncDir, STATE_FILES.STATE);
  if (fs.existsSync(stateFile)) {
    try {
      const privateKey = loadKey(configDir);
      const ciphertext = fs.readFileSync(stateFile, 'utf-8');
      const state = await decryptState<{ projects?: Array<{ name: string }> }>(
        ciphertext,
        privateKey,
      );

      if (state.projects && Array.isArray(state.projects)) {
        projectCount = state.projects.length;
        for (const project of state.projects) {
          if (project.name) {
            projectNames.push(project.name);
          }
        }
      }
    } catch {
      // Decryption failed — wrong key or no state yet
      // This is not fatal for restore setup
    }
  }

  return {
    configDir,
    syncDir,
    remoteUrl,
    projectCount,
    projectNames,
  };
}

/**
 * Read key from stdin (for piped input).
 */
export function readKeyFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';

    if (process.stdin.isTTY) {
      reject(new Error('No data piped to stdin. Use: echo "AGE-SECRET-KEY-..." | ctx-sync init --restore --stdin'));
      return;
    }

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    process.stdin.on('error', reject);
  });
}

/**
 * Register the `init` command on the given Commander program.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize ctx-sync (generate keys, set up sync repo)')
    .option('--restore', 'Restore from backup on a new machine')
    .option('--no-interactive', 'Skip interactive prompts (use defaults)')
    .option('--skip-backup', 'Skip key backup prompt (not recommended)')
    .option('--remote <url>', 'Git remote URL for syncing')
    .option('--stdin', 'Read private key from stdin (for --restore)')
    .action(withErrorHandler(async (opts: Record<string, unknown>) => {
      const options: InitOptions & { key?: string } = {
        restore: opts['restore'] as boolean | undefined,
        noInteractive: opts['interactive'] === false,
        skipBackup: opts['skipBackup'] as boolean | undefined,
        remote: opts['remote'] as string | undefined,
        stdin: opts['stdin'] as boolean | undefined,
      };

      if (options.restore) {
          // Restore flow
          if (options.stdin) {
            options.key = await readKeyFromStdin();
          } else if (!options.noInteractive) {
            // Interactive prompt for key
            const Enquirer = (await import('enquirer')).default;
            const enquirer = new Enquirer<{ key: string }>();
            const response = await enquirer.prompt({
              type: 'password',
              name: 'key',
              message: 'Paste your private key (AGE-SECRET-KEY-...):',
            });
            options.key = response.key;
          } else {
            throw new Error(
              'Private key is required for restore.\n' +
                'Use --stdin to pipe the key, or run without --no-interactive for a prompt.',
            );
          }

          const result = await executeRestore(options);

          const chalk = (await import('chalk')).default;
          console.log(chalk.green('✅ Key restored') + ' (permissions set to 600)');
          console.log(`📂 Sync directory: ${result.syncDir}`);

          if (result.remoteUrl) {
            const isSSH = result.remoteUrl.startsWith('git@') || result.remoteUrl.includes('ssh://');
            const transport = isSSH ? 'SSH' : 'HTTPS';
            console.log(chalk.green(`✅ ${transport} transport detected (secure)`));
            console.log(chalk.green('✅ Remote configured:') + ` ${result.remoteUrl}`);
          } else {
            console.log(chalk.dim('   No remote configured — local only.'));
          }

          if (result.projectCount > 0) {
            console.log(chalk.green(`✅ Found ${result.projectCount} projects:`));
            for (const name of result.projectNames) {
              console.log(`   - ${name}`);
            }
          } else {
            console.log('No existing projects found (sync repo may be empty).');
          }

          console.log('\nAll state decrypted! 🎉');
        } else {
          // Fresh init flow
          const result = await executeInit(options);

          const chalk = (await import('chalk')).default;
          console.log('\n🔐 Generating encryption key...');
          console.log(chalk.green('✅ Public key: ') + result.publicKey);
          console.log(
            chalk.green('✅ Private key saved to: ') +
              path.join(result.configDir, 'key.txt'),
          );
          console.log('   Permissions: 600 (owner read/write only)');

          if (!options.skipBackup && !options.noInteractive) {
            console.log(
              chalk.yellow('\n⚠️  IMPORTANT: Back up your private key NOW!'),
            );
            console.log('Save it to 1Password, Bitwarden, or another password manager.');
          }

          if (result.remoteUrl) {
            const isSSH = result.remoteUrl.startsWith('git@') || result.remoteUrl.includes('ssh://');
            const transport = isSSH ? 'SSH' : 'HTTPS';
            console.log(chalk.green(`\n✅ ${transport} transport detected (secure)`));
            console.log(chalk.green('✅ Remote configured:') + ` ${result.remoteUrl}`);
          } else {
            console.log(chalk.dim('\n   No remote configured — syncing locally only.'));
            console.log(chalk.dim('   To add a remote later: ctx-sync init --remote <url>'));
          }

          console.log(chalk.green('\n✅ All set!'));
          console.log('\nNow track your first project:');
          console.log('  $ cd ~/projects/my-app');
          console.log('  $ ctx-sync track');
        }
    }));
}
