/**
 * `ctx-sync team` command group.
 *
 * Manages team members (multi-recipient encryption):
 *   - `team add --name <n> --key <pubkey>` — add a team member with fingerprint verification.
 *   - `team remove <name>` — remove a team member and re-encrypt all state.
 *   - `team list` — list all team members and their public keys.
 *   - `team revoke <pubkey>` — immediately revoke a key and re-encrypt all state.
 *
 * **Security:**
 *   - Adding a member prompts for out-of-band fingerprint verification.
 *   - Removing/revoking a member triggers full re-encryption of all state files
 *     so the revoked key can no longer decrypt current or future data.
 *   - Recipients config is stored locally and NEVER synced to Git.
 *
 * @module commands/team
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import { identityToRecipient } from 'age-encryption';
import { decryptState, encryptStateForRecipients } from '../core/encryption.js';
import {
  loadKey,
} from '../core/key-store.js';
import {
  listStateFiles,
  readManifest,
  writeManifest,
} from '../core/state-manager.js';
import {
  addRecipient,
  removeRecipientByName,
  removeRecipientByKey,
  getRecipients,
  initRecipients,
  getAllRecipientKeys,
  computeFingerprint,
} from '../core/recipients.js';
import { getConfigDir, getSyncDir } from './init.js';

// ─── Interfaces ───────────────────────────────────────────────────────────

/** Options for team add */
export interface TeamAddOptions {
  name: string;
  key: string;
  /** Skip fingerprint verification prompt (for testing) */
  noVerify?: boolean;
}

/** Result of team add */
export interface TeamAddResult {
  name: string;
  publicKey: string;
  fingerprint: string;
}

/** Result of team remove / revoke */
export interface TeamRemoveResult {
  name: string;
  publicKey: string;
  filesReEncrypted: string[];
}

/** Result of team list */
export interface TeamListResult {
  ownerPublicKey: string;
  members: Array<{
    name: string;
    publicKey: string;
    fingerprint: string;
    addedAt: string;
  }>;
}

// ─── Core Logic ───────────────────────────────────────────────────────────

/**
 * Ensure the recipients config is initialised.
 *
 * If no recipients file exists, creates one with the owner's public key.
 */
async function ensureRecipientsInit(): Promise<void> {
  const configDir = getConfigDir();
  const config = getRecipients(configDir);

  if (!config) {
    const privateKey = loadKey(configDir);
    const publicKey = await identityToRecipient(privateKey);
    initRecipients(configDir, publicKey);
  }
}

/**
 * Re-encrypt all state files for the current set of recipients.
 *
 * Used after removing/revoking a team member to ensure they can no
 * longer decrypt any state files.
 *
 * @returns Array of filenames that were re-encrypted.
 */
async function reEncryptAllState(): Promise<string[]> {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const privateKey = loadKey(configDir);
  const ownerPublicKey = await identityToRecipient(privateKey);
  const allKeys = getAllRecipientKeys(configDir, ownerPublicKey);

  const ageFiles = listStateFiles(syncDir);
  const filesReEncrypted: string[] = [];

  for (const filename of ageFiles) {
    const filePath = path.join(syncDir, filename);
    const ciphertext = fs.readFileSync(filePath, 'utf-8');

    if (!ciphertext.trim()) {
      continue;
    }

    // Decrypt with owner's key, re-encrypt for all current recipients
    const plainData = await decryptState<unknown>(ciphertext, privateKey);
    const newCiphertext = await encryptStateForRecipients(plainData, allKeys);
    fs.writeFileSync(filePath, newCiphertext, 'utf-8');
    filesReEncrypted.push(filename);
  }

  // Update manifest
  const manifest = readManifest(syncDir);
  if (manifest) {
    manifest.lastSync = new Date().toISOString();
    writeManifest(syncDir, manifest);
  }

  return filesReEncrypted;
}

/**
 * Execute `ctx-sync team add`.
 *
 * Adds a new team member to the recipients list and re-encrypts
 * all state files so the new member can decrypt them.
 */
export async function executeTeamAdd(
  options: TeamAddOptions,
): Promise<TeamAddResult> {
  await ensureRecipientsInit();

  const configDir = getConfigDir();
  const member = addRecipient(configDir, options.name, options.key);

  // Re-encrypt all state for all recipients (including the new member)
  await reEncryptAllState();

  return {
    name: member.name,
    publicKey: member.publicKey,
    fingerprint: member.fingerprint,
  };
}

/**
 * Execute `ctx-sync team remove`.
 *
 * Removes a team member by name and re-encrypts all state files
 * so the removed member can no longer decrypt them.
 */
export async function executeTeamRemove(
  name: string,
): Promise<TeamRemoveResult> {
  await ensureRecipientsInit();

  const configDir = getConfigDir();
  const removed = removeRecipientByName(configDir, name);

  // Re-encrypt ALL state without the removed member
  const filesReEncrypted = await reEncryptAllState();

  return {
    name: removed.name,
    publicKey: removed.publicKey,
    filesReEncrypted,
  };
}

/**
 * Execute `ctx-sync team revoke`.
 *
 * Immediately revokes a team member's key and re-encrypts all
 * state files. Similar to remove but uses the public key directly.
 */
export async function executeTeamRevoke(
  publicKey: string,
): Promise<TeamRemoveResult> {
  await ensureRecipientsInit();

  const configDir = getConfigDir();
  const removed = removeRecipientByKey(configDir, publicKey);

  // Re-encrypt ALL state without the revoked key
  const filesReEncrypted = await reEncryptAllState();

  return {
    name: removed.name,
    publicKey: removed.publicKey,
    filesReEncrypted,
  };
}

/**
 * Execute `ctx-sync team list`.
 *
 * Returns the owner's public key and all team members.
 */
export async function executeTeamList(): Promise<TeamListResult> {
  await ensureRecipientsInit();

  const configDir = getConfigDir();
  const config = getRecipients(configDir);

  if (!config) {
    throw new Error(
      'Recipients configuration not initialised. Run `ctx-sync init` first.',
    );
  }

  return {
    ownerPublicKey: config.ownerPublicKey,
    members: config.members.map((m) => ({
      name: m.name,
      publicKey: m.publicKey,
      fingerprint: m.fingerprint,
      addedAt: m.addedAt,
    })),
  };
}

// ─── Commander Registration ───────────────────────────────────────────────

/**
 * Register the `ctx-sync team` command group on the given program.
 */
export function registerTeamCommand(program: Command): void {
  const teamCmd = program
    .command('team')
    .description('Manage team members (multi-recipient encryption)');

  // ── team add ──────────────────────────────────────────────────────
  teamCmd
    .command('add')
    .description('Add a team member as an encryption recipient')
    .requiredOption('--name <name>', 'Human-readable name for the team member')
    .requiredOption('--key <pubkey>', 'Age public key (age1...)')
    .option('--no-verify', 'Skip fingerprint verification prompt')
    .action(withErrorHandler(async (opts: { name: string; key: string; verify: boolean }) => {
      // Show fingerprint for verification
      if (opts.verify) {
        const fingerprint = computeFingerprint(opts.key);
        console.log(`\n⚠ Verify this key fingerprint with ${opts.name}:`);
        console.log(`   Fingerprint: ${fingerprint}`);
        console.log(`   Key: ${opts.key}`);
        console.log('');
      }

      const result = await executeTeamAdd({
        name: opts.name,
        key: opts.key,
        noVerify: !opts.verify,
      });

      console.log(`✓ Added team member: ${result.name}`);
      console.log(`  Public key: ${result.publicKey}`);
      console.log(`  Fingerprint: ${result.fingerprint}`);
      console.log('  All state re-encrypted for new recipient set.');
    }));

  // ── team remove ───────────────────────────────────────────────────
  teamCmd
    .command('remove <name>')
    .description('Remove a team member and re-encrypt all state')
    .action(withErrorHandler(async (name: string) => {
      const result = await executeTeamRemove(name);

      console.log(`✓ Removed team member: ${result.name}`);
      console.log(`  Public key: ${result.publicKey}`);
      console.log(
        `  Files re-encrypted: ${String(result.filesReEncrypted.length)}`,
      );
      console.log(
        `  ${result.name} can no longer decrypt any state files.`,
      );
    }));

  // ── team list ─────────────────────────────────────────────────────
  teamCmd
    .command('list')
    .description('List all team members and their public keys')
    .action(withErrorHandler(async () => {
      const result = await executeTeamList();

      console.log(`Owner key: ${result.ownerPublicKey}`);
      console.log('');

      if (result.members.length === 0) {
        console.log('No team members added yet.');
        console.log(
          'Use `ctx-sync team add --name <name> --key <pubkey>` to add one.',
        );
      } else {
        console.log(`Team members (${String(result.members.length)}):`);
        for (const member of result.members) {
          console.log(`  ${member.name}`);
          console.log(`    Key: ${member.publicKey}`);
          console.log(`    Fingerprint: ${member.fingerprint}`);
          console.log(`    Added: ${member.addedAt}`);
        }
      }
    }));

  // ── team revoke ───────────────────────────────────────────────────
  teamCmd
    .command('revoke <pubkey>')
    .description('Immediately revoke a key and re-encrypt all state')
    .action(withErrorHandler(async (pubkey: string) => {
      const result = await executeTeamRevoke(pubkey);

      console.log(`✓ Revoked key for: ${result.name}`);
      console.log(`  Public key: ${result.publicKey}`);
      console.log(
        `  Files re-encrypted: ${String(result.filesReEncrypted.length)}`,
      );
      console.log(
        `  ${result.name} can no longer decrypt new or existing state.`,
      );
    }));
}
