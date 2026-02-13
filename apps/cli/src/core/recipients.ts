/**
 * Recipients store module.
 *
 * Manages the list of team members (recipients) who can decrypt
 * encrypted state files. The recipients configuration is stored
 * locally in the config directory and is NEVER synced to Git.
 *
 * When multiple recipients are configured, all state files are
 * encrypted for all recipients simultaneously using Age's
 * multi-recipient support.
 *
 * @module core/recipients
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { TeamMember, RecipientsConfig } from '@ctx-sync/shared';

/** Recipients config file name (stored in config dir, never synced) */
export const RECIPIENTS_FILE = 'recipients.json';

/**
 * Compute a fingerprint for an Age public key.
 *
 * Uses SHA-256 and formats as colon-separated hex pairs (e.g. A3:F2:9C:...).
 * This is used for out-of-band key verification.
 *
 * @param publicKey - An Age public key (age1...).
 * @returns A colon-separated hex fingerprint string.
 */
export function computeFingerprint(publicKey: string): string {
  const hash = crypto.createHash('sha256').update(publicKey).digest('hex');
  // Format as colon-separated pairs: A3:F2:9C:...
  const pairs = hash.substring(0, 32).match(/.{2}/g) ?? [];
  return pairs.join(':').toUpperCase();
}

/**
 * Read the recipients configuration from the config directory.
 *
 * @param configDir - The config directory path (e.g. ~/.config/ctx-sync).
 * @returns The recipients configuration, or `null` if the file does not exist.
 */
export function getRecipients(configDir: string): RecipientsConfig | null {
  const filePath = path.join(configDir, RECIPIENTS_FILE);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  if (!content.trim()) {
    return null;
  }

  return JSON.parse(content) as RecipientsConfig;
}

/**
 * Save the recipients configuration to the config directory.
 *
 * @param configDir - The config directory path.
 * @param config - The recipients configuration to save.
 */
export function saveRecipients(
  configDir: string,
  config: RecipientsConfig,
): void {
  const filePath = path.join(configDir, RECIPIENTS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Initialize the recipients configuration with the owner's public key.
 *
 * Creates the recipients file if it does not exist, setting the owner
 * as the sole recipient.
 *
 * @param configDir - The config directory path.
 * @param ownerPublicKey - The owner's Age public key (age1...).
 * @returns The initialised recipients configuration.
 */
export function initRecipients(
  configDir: string,
  ownerPublicKey: string,
): RecipientsConfig {
  const existing = getRecipients(configDir);
  if (existing) {
    return existing;
  }

  const config: RecipientsConfig = {
    ownerPublicKey,
    members: [],
  };

  saveRecipients(configDir, config);
  return config;
}

/**
 * Get all public keys that should be used for encryption.
 *
 * Returns the owner's key plus all team member keys. If no recipients
 * config exists, returns only the provided owner key.
 *
 * @param configDir - The config directory path.
 * @param ownerPublicKey - The owner's Age public key (fallback if no config).
 * @returns Array of all recipient public keys.
 */
export function getAllRecipientKeys(
  configDir: string,
  ownerPublicKey: string,
): string[] {
  const config = getRecipients(configDir);

  if (!config) {
    return [ownerPublicKey];
  }

  const keys = [config.ownerPublicKey];
  for (const member of config.members) {
    keys.push(member.publicKey);
  }

  return keys;
}

/**
 * Add a team member to the recipients list.
 *
 * @param configDir - The config directory path.
 * @param name - A human-readable name for the team member.
 * @param publicKey - The member's Age public key (age1...).
 * @returns The added team member object.
 * @throws If the public key is already in the recipients list.
 * @throws If the public key format is invalid.
 */
export function addRecipient(
  configDir: string,
  name: string,
  publicKey: string,
): TeamMember {
  // Validate key format
  if (!publicKey.startsWith('age1')) {
    throw new Error(
      `Invalid Age public key format. Expected key starting with "age1", got: ${publicKey.substring(0, 10)}...`,
    );
  }

  const config = getRecipients(configDir);
  if (!config) {
    throw new Error(
      'Recipients configuration not initialised. Run `ctx-sync init` first.',
    );
  }

  // Check for duplicate key
  if (config.ownerPublicKey === publicKey) {
    throw new Error('Cannot add your own key as a team member.');
  }

  const existingMember = config.members.find(
    (m) => m.publicKey === publicKey,
  );
  if (existingMember) {
    throw new Error(
      `Public key already registered for team member "${existingMember.name}".`,
    );
  }

  // Check for duplicate name
  const existingName = config.members.find(
    (m) => m.name.toLowerCase() === name.toLowerCase(),
  );
  if (existingName) {
    throw new Error(
      `Team member with name "${name}" already exists. Use a unique name.`,
    );
  }

  const fingerprint = computeFingerprint(publicKey);

  const member: TeamMember = {
    name,
    publicKey,
    addedAt: new Date().toISOString(),
    fingerprint,
  };

  config.members.push(member);
  saveRecipients(configDir, config);

  return member;
}

/**
 * Remove a team member by name.
 *
 * @param configDir - The config directory path.
 * @param name - The name of the team member to remove.
 * @returns The removed team member object.
 * @throws If no member with the given name exists.
 */
export function removeRecipientByName(
  configDir: string,
  name: string,
): TeamMember {
  const config = getRecipients(configDir);
  if (!config) {
    throw new Error(
      'Recipients configuration not initialised. Run `ctx-sync init` first.',
    );
  }

  const index = config.members.findIndex(
    (m) => m.name.toLowerCase() === name.toLowerCase(),
  );
  if (index === -1) {
    throw new Error(`No team member found with name "${name}".`);
  }

  const removed = config.members[index];
  config.members.splice(index, 1);
  saveRecipients(configDir, config);

  // Safe: index was validated above so removed is always defined
  return removed as TeamMember;
}

/**
 * Remove a team member by public key (revoke).
 *
 * @param configDir - The config directory path.
 * @param publicKey - The Age public key of the member to revoke.
 * @returns The removed team member object.
 * @throws If no member with the given key exists.
 */
export function removeRecipientByKey(
  configDir: string,
  publicKey: string,
): TeamMember {
  const config = getRecipients(configDir);
  if (!config) {
    throw new Error(
      'Recipients configuration not initialised. Run `ctx-sync init` first.',
    );
  }

  const index = config.members.findIndex((m) => m.publicKey === publicKey);
  if (index === -1) {
    throw new Error(`No team member found with public key "${publicKey}".`);
  }

  const removed = config.members[index];
  config.members.splice(index, 1);
  saveRecipients(configDir, config);

  // Safe: index was validated above so removed is always defined
  return removed as TeamMember;
}

/**
 * List all team members.
 *
 * @param configDir - The config directory path.
 * @returns Array of team members (empty if no recipients config or no members).
 */
export function listRecipients(configDir: string): TeamMember[] {
  const config = getRecipients(configDir);
  if (!config) {
    return [];
  }
  return config.members;
}
