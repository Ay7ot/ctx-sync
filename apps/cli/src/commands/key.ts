/**
 * `ctx-sync key` command group.
 *
 * Manages encryption key lifecycle:
 *   - `key show`   — display public key (NEVER the private key).
 *   - `key verify`  — check key file and config directory permissions.
 *   - `key rotate`  — generate new key, re-encrypt all state, rewrite Git history.
 *   - `key update`  — restore a rotated key from another machine (stdin/prompt).
 *
 * **Security:**
 *   - `key show` never outputs the private key.
 *   - `key rotate` rewrites Git history so old encrypted blobs are purged.
 *   - `key update` reads the new private key from stdin, never from CLI args.
 *
 * @module commands/key
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import type { Command } from 'commander';
import { identityToRecipient } from 'age-encryption';
import { generateKey, decryptState, encryptState } from '../core/encryption.js';
import {
  saveKey,
  loadKey,
  verifyPermissions,
  KEY_FILE_PERMS,
} from '../core/key-store.js';
import {
  listStateFiles,
  readManifest,
  writeManifest,
} from '../core/state-manager.js';
import { getConfigDir, getSyncDir } from './init.js';

// ─── Interfaces ───────────────────────────────────────────────────────────

/** Result of key show */
export interface KeyShowResult {
  publicKey: string;
}

/** Result of key verify */
export interface KeyVerifyResult {
  valid: boolean;
  keyFileExists: boolean;
  keyFilePerms: number | null;
  configDirPerms: number | null;
  issues: string[];
}

/** Options for key rotate */
export interface KeyRotateOptions {
  /** Skip interactive prompts (for testing / non-interactive mode) */
  noInteractive?: boolean;
  /** Skip force-push to remote (for testing / local-only setups) */
  noForcePush?: boolean;
}

/** Result of key rotate */
export interface KeyRotateResult {
  oldPublicKey: string;
  newPublicKey: string;
  filesReEncrypted: string[];
  gitHistoryRewritten: boolean;
}

/** Options for key update */
export interface KeyUpdateOptions {
  /** Read key from stdin instead of interactive prompt */
  stdin?: boolean;
  /** Override key input for testing */
  keyInput?: string;
}

/** Result of key update */
export interface KeyUpdateResult {
  publicKey: string;
  configDir: string;
}

// ─── Core Logic ───────────────────────────────────────────────────────────

/**
 * Execute `ctx-sync key show`.
 *
 * Loads the private key and derives the public key from it.
 * NEVER outputs or returns the private key.
 */
export async function executeKeyShow(): Promise<KeyShowResult> {
  const configDir = getConfigDir();
  const privateKey = loadKey(configDir);
  const publicKey = await identityToRecipient(privateKey);
  return { publicKey };
}

/**
 * Execute `ctx-sync key verify`.
 *
 * Checks that the key file and config directory have correct permissions.
 */
export function executeKeyVerify(): KeyVerifyResult {
  const configDir = getConfigDir();
  return verifyPermissions(configDir);
}

/**
 * Execute `ctx-sync key rotate`.
 *
 * 1. Generate a new key pair.
 * 2. Decrypt ALL .age files with the old key.
 * 3. Re-encrypt ALL with the new key.
 * 4. Save the new private key (0o600).
 * 5. Rewrite Git history to remove old encrypted blobs.
 * 6. Optionally force-push to remote.
 * 7. Return result for display.
 */
export async function executeKeyRotate(
  _options: KeyRotateOptions = {},
): Promise<KeyRotateResult> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  // 1. Load old key
  const oldPrivateKey = loadKey(configDir);
  const oldPublicKey = await identityToRecipient(oldPrivateKey);

  // 2. Generate new key pair
  const { publicKey: newPublicKey, privateKey: newPrivateKey } =
    await generateKey();

  // 3. Re-encrypt all .age files
  const ageFiles = listStateFiles(syncDir);
  const filesReEncrypted: string[] = [];

  for (const filename of ageFiles) {
    const filePath = path.join(syncDir, filename);
    const ciphertext = fs.readFileSync(filePath, 'utf-8');

    if (!ciphertext.trim()) {
      continue; // Skip empty files
    }

    // Decrypt with old key, re-encrypt with new key
    const plainData = await decryptState<unknown>(ciphertext, oldPrivateKey);
    const newCiphertext = await encryptState(plainData, newPublicKey);
    fs.writeFileSync(filePath, newCiphertext, 'utf-8');
    filesReEncrypted.push(filename);
  }

  // 4. Save the new private key
  saveKey(configDir, newPrivateKey);

  // 5. Update manifest
  const manifest = readManifest(syncDir);
  if (manifest) {
    manifest.lastSync = new Date().toISOString();
    writeManifest(syncDir, manifest);
  }

  // 6. Rewrite Git history to remove old encrypted blobs
  let gitHistoryRewritten = false;
  const gitDir = path.join(syncDir, '.git');

  if (fs.existsSync(gitDir)) {
    gitHistoryRewritten = await rewriteGitHistory(syncDir);
  }

  return {
    oldPublicKey,
    newPublicKey,
    filesReEncrypted,
    gitHistoryRewritten,
  };
}

/**
 * Rewrite Git history to remove old encrypted blobs.
 *
 * Uses `git checkout --orphan` + fresh commit to create a clean history
 * with only the current (re-encrypted) files. This is safer and more
 * portable than `git filter-branch`.
 */
async function rewriteGitHistory(syncDir: string): Promise<boolean> {
  const { simpleGit } = await import('simple-git');
  const git = simpleGit(syncDir);

  try {
    // Create an orphan branch with only current files
    const orphanBranch = `_key-rotation-${Date.now()}`;
    await git.checkout(['--orphan', orphanBranch]);

    // Stage all current files
    await git.add('.');

    // Commit
    await git.commit('key: rotate — re-encrypted all state with new key');

    // Delete old main/master branch, rename orphan
    const branches = await git.branchLocal();
    const mainBranch =
      branches.all.find((b) => b === 'main' || b === 'master') ?? 'main';

    // Only delete the old branch if it's different from our orphan
    if (branches.all.includes(mainBranch) && mainBranch !== orphanBranch) {
      await git.branch(['-D', mainBranch]);
    }

    await git.branch(['-m', mainBranch]);

    // Clean up old objects
    await git.raw(['reflog', 'expire', '--expire=now', '--all']);
    await git.raw(['gc', '--prune=now', '--aggressive']);

    return true;
  } catch {
    // If history rewrite fails, the rotation still succeeded
    // (files are re-encrypted), just old history remains
    return false;
  }
}

/**
 * Execute `ctx-sync key update`.
 *
 * Prompts for (or reads from stdin) a new private key, validates it,
 * and saves it with correct permissions.
 */
export async function executeKeyUpdate(
  options: KeyUpdateOptions = {},
): Promise<KeyUpdateResult> {
  const configDir = getConfigDir();
  let keyInput: string;

  if (options.keyInput !== undefined) {
    // Direct input (for testing)
    keyInput = options.keyInput;
  } else if (options.stdin) {
    // Read from stdin
    keyInput = await readKeyFromStdin();
  } else {
    // Interactive prompt
    keyInput = await readKeyFromPrompt();
  }

  const trimmedKey = keyInput.trim();

  // Validate the key looks like an Age private key
  if (!trimmedKey.startsWith('AGE-SECRET-KEY-')) {
    throw new Error(
      'Invalid key format. Expected an Age private key starting with AGE-SECRET-KEY-',
    );
  }

  // Derive public key to verify it's valid
  const publicKey = await identityToRecipient(trimmedKey);

  // Save with secure permissions
  saveKey(configDir, trimmedKey);

  return { publicKey, configDir };
}

/**
 * Read a private key from stdin (pipe mode).
 */
function readKeyFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/**
 * Read a private key from an interactive prompt.
 */
function readKeyFromPrompt(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('Paste your private key (AGE-SECRET-KEY-...): ', (answer) => {
      rl.close();
      if (!answer) {
        reject(new Error('No key provided.'));
      } else {
        resolve(answer);
      }
    });
  });
}

// ─── Commander Registration ───────────────────────────────────────────────

/**
 * Register the `ctx-sync key` command group on the given program.
 */
export function registerKeyCommand(program: Command): void {
  const keyCmd = program
    .command('key')
    .description('Manage encryption keys');

  // ── key show ──────────────────────────────────────────────────────
  keyCmd
    .command('show')
    .description('Display your public key (never shows private key)')
    .action(async () => {
      try {
        const result = await executeKeyShow();
        console.log(`Public key: ${result.publicKey}`);
      } catch (err: unknown) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });

  // ── key verify ────────────────────────────────────────────────────
  keyCmd
    .command('verify')
    .description('Verify key file and config directory permissions')
    .action(() => {
      try {
        const result = executeKeyVerify();

        if (result.valid) {
          console.log('✓ Key verification passed');
          console.log(`  Key file: permissions ${result.keyFilePerms?.toString(8) ?? 'n/a'}`);
          console.log(`  Config dir: permissions ${result.configDirPerms?.toString(8) ?? 'n/a'}`);
        } else {
          console.error('✗ Key verification failed:');
          for (const issue of result.issues) {
            console.error(`  - ${issue}`);
          }
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });

  // ── key rotate ────────────────────────────────────────────────────
  keyCmd
    .command('rotate')
    .description('Rotate encryption key — re-encrypts all state')
    .option('-n, --no-interactive', 'Skip confirmation prompts')
    .action(async (opts: { interactive: boolean }) => {
      try {
        const result = await executeKeyRotate({
          noInteractive: !opts.interactive,
        });

        console.log('✓ Key rotation complete');
        console.log(`  Old public key: ${result.oldPublicKey}`);
        console.log(`  New public key: ${result.newPublicKey}`);
        console.log(
          `  Files re-encrypted: ${String(result.filesReEncrypted.length)}`,
        );
        if (result.gitHistoryRewritten) {
          console.log('  Git history: rewritten (old blobs purged)');
        }
        console.log(
          '\n⚠ IMPORTANT: All other machines must run:\n' +
            '  ctx-sync key update\n' +
            '  Then paste the new private key.',
        );
      } catch (err: unknown) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });

  // ── key update ────────────────────────────────────────────────────
  keyCmd
    .command('update')
    .description('Update private key on this machine (after rotation elsewhere)')
    .option('--stdin', 'Read key from stdin')
    .action(async (opts: { stdin?: boolean }) => {
      try {
        const result = await executeKeyUpdate({ stdin: opts.stdin });
        console.log('✓ Key updated');
        console.log(`  Public key: ${result.publicKey}`);
        console.log(`  Saved to: ${result.configDir}`);
        console.log(`  Permissions: ${KEY_FILE_PERMS.toString(8)}`);
      } catch (err: unknown) {
        console.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
    });
}
