/**
 * Key persistence module.
 *
 * Handles saving and loading the Age private key to/from disk
 * with strict file permission enforcement. The private key file
 * is stored at 0o600 (owner read/write only) and the config
 * directory at 0o700 (owner read/write/execute only).
 *
 * @module core/key-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Required permissions for the private key file */
export const KEY_FILE_PERMS = 0o600;

/** Required permissions for the config directory */
export const CONFIG_DIR_PERMS = 0o700;

/** Default key file name */
export const KEY_FILE_NAME = 'key.txt';

/**
 * Save a private key to disk with strict permissions.
 *
 * Creates the config directory with 0o700 permissions if it does not exist,
 * then writes the key file with 0o600 permissions.
 *
 * @param configDir - The config directory path (e.g. ~/.config/ctx-sync).
 * @param privateKey - The Age private key string (AGE-SECRET-KEY-...).
 */
export function saveKey(configDir: string, privateKey: string): void {
  // Create directory with 0o700 if it doesn't exist
  fs.mkdirSync(configDir, { recursive: true, mode: CONFIG_DIR_PERMS });

  // Ensure directory has correct permissions even if it already existed
  fs.chmodSync(configDir, CONFIG_DIR_PERMS);

  const keyPath = path.join(configDir, KEY_FILE_NAME);
  fs.writeFileSync(keyPath, privateKey, { mode: KEY_FILE_PERMS });
}

/**
 * Load a private key from disk, verifying permissions are secure.
 *
 * Checks that the key file exists and has exactly 0o600 permissions
 * before reading. Throws with a helpful error if permissions are insecure.
 *
 * @param configDir - The config directory path (e.g. ~/.config/ctx-sync).
 * @returns The Age private key string.
 * @throws If the key file does not exist or has insecure permissions.
 */
export function loadKey(configDir: string): string {
  const keyPath = path.join(configDir, KEY_FILE_NAME);

  // Check file exists
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `Key file not found: ${keyPath}\n` +
        'Run `ctx-sync init` to generate an encryption key, or\n' +
        'Run `ctx-sync init --restore` to restore from a backup.',
    );
  }

  // Verify permissions before reading
  const stats = fs.statSync(keyPath);
  const mode = stats.mode & 0o777;

  if (mode !== KEY_FILE_PERMS) {
    throw new Error(
      `Key file has insecure permissions (${mode.toString(8)}). Expected 600.\n` +
        `Fix with: chmod 600 ${keyPath}`,
    );
  }

  return fs.readFileSync(keyPath, 'utf-8').trim();
}

/**
 * Verify that key file and config directory have correct permissions.
 *
 * @param configDir - The config directory path.
 * @returns An object describing the verification result.
 */
export function verifyPermissions(configDir: string): {
  valid: boolean;
  keyFileExists: boolean;
  keyFilePerms: number | null;
  configDirPerms: number | null;
  issues: string[];
} {
  const issues: string[] = [];
  const keyPath = path.join(configDir, KEY_FILE_NAME);

  let keyFileExists = false;
  let keyFilePerms: number | null = null;
  let configDirPerms: number | null = null;

  // Check config directory
  if (fs.existsSync(configDir)) {
    const dirStats = fs.statSync(configDir);
    configDirPerms = dirStats.mode & 0o777;
    if (configDirPerms !== CONFIG_DIR_PERMS) {
      issues.push(
        `Config directory has permissions ${configDirPerms.toString(8)}, expected 700. ` +
          `Fix with: chmod 700 ${configDir}`,
      );
    }
  } else {
    issues.push(`Config directory does not exist: ${configDir}`);
  }

  // Check key file
  if (fs.existsSync(keyPath)) {
    keyFileExists = true;
    const fileStats = fs.statSync(keyPath);
    keyFilePerms = fileStats.mode & 0o777;
    if (keyFilePerms !== KEY_FILE_PERMS) {
      issues.push(
        `Key file has permissions ${keyFilePerms.toString(8)}, expected 600. ` +
          `Fix with: chmod 600 ${keyPath}`,
      );
    }
  } else {
    issues.push(`Key file not found: ${keyPath}`);
  }

  return {
    valid: issues.length === 0,
    keyFileExists,
    keyFilePerms,
    configDirPerms,
    issues,
  };
}
