/**
 * Local user configuration store.
 *
 * Manages `config.json` in the config directory (~/.config/ctx-sync/).
 * This file is NEVER synced to Git — it holds local preferences only.
 *
 * Primary use: custom safe-list additions that merge with DEFAULT_SAFE_LIST.
 *
 * @module core/config-store
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_SAFE_LIST } from '@ctx-sync/shared';
import type { UserConfig } from '@ctx-sync/shared';

/** Config file name (stored in config dir, never synced) */
export const CONFIG_FILE = 'config.json';

/**
 * Load the user config from disk.
 *
 * @param configDir - The config directory path (~/.config/ctx-sync).
 * @returns The parsed UserConfig, or `null` if the file does not exist.
 */
export function getUserConfig(configDir: string): UserConfig | null {
  const filePath = path.join(configDir, CONFIG_FILE);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  if (!content.trim()) {
    return null;
  }

  return JSON.parse(content) as UserConfig;
}

/**
 * Save the user config to disk.
 *
 * @param configDir - The config directory path.
 * @param config - The UserConfig to persist.
 */
export function saveUserConfig(configDir: string, config: UserConfig): void {
  const filePath = path.join(configDir, CONFIG_FILE);

  // Ensure the config directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get the effective safe-list: DEFAULT_SAFE_LIST merged with user additions.
 *
 * User keys are uppercased and deduplicated against the defaults.
 *
 * @param configDir - The config directory path.
 * @returns The merged safe-list (all uppercase).
 */
export function getEffectiveSafeList(configDir: string): string[] {
  const config = getUserConfig(configDir);
  const userKeys = config?.safeList ?? [];

  // Merge: defaults + user additions (uppercased, deduplicated)
  const merged = new Set<string>(DEFAULT_SAFE_LIST);
  for (const key of userKeys) {
    merged.add(key.toUpperCase());
  }

  return [...merged];
}

/**
 * Add a key to the user's custom safe-list.
 *
 * The key is normalised to uppercase. Duplicate additions (already in
 * default or custom list) are detected and reported.
 *
 * @param configDir - The config directory path.
 * @param key - The env var key to add.
 * @returns An object indicating whether the key was added and a message.
 */
export function addToSafeList(
  configDir: string,
  key: string,
): { added: boolean; message: string } {
  const normKey = key.toUpperCase();

  // Check if already in default safe-list
  if (DEFAULT_SAFE_LIST.includes(normKey)) {
    return {
      added: false,
      message: `${normKey} is already in the default safe-list.`,
    };
  }

  const config = getUserConfig(configDir) ?? {};
  const existing = (config.safeList ?? []).map((k) => k.toUpperCase());

  if (existing.includes(normKey)) {
    return {
      added: false,
      message: `${normKey} is already in your custom safe-list.`,
    };
  }

  config.safeList = [...(config.safeList ?? []), normKey];
  saveUserConfig(configDir, config);

  return {
    added: true,
    message: `Added ${normKey} to the safe-list.`,
  };
}

/**
 * Remove a key from the user's custom safe-list.
 *
 * Keys that are part of DEFAULT_SAFE_LIST cannot be removed (they are
 * built-in). Only user-added custom keys can be removed.
 *
 * @param configDir - The config directory path.
 * @param key - The env var key to remove.
 * @returns An object indicating whether the key was removed and a message.
 */
export function removeFromSafeList(
  configDir: string,
  key: string,
): { removed: boolean; message: string } {
  const normKey = key.toUpperCase();

  // Cannot remove default keys
  if (DEFAULT_SAFE_LIST.includes(normKey)) {
    return {
      removed: false,
      message: `${normKey} is a built-in default and cannot be removed. It will always be on the safe-list.`,
    };
  }

  const config = getUserConfig(configDir) ?? {};
  const existing = (config.safeList ?? []).map((k) => k.toUpperCase());

  if (!existing.includes(normKey)) {
    return {
      removed: false,
      message: `${normKey} is not in your custom safe-list.`,
    };
  }

  config.safeList = (config.safeList ?? []).filter(
    (k) => k.toUpperCase() !== normKey,
  );
  saveUserConfig(configDir, config);

  return {
    removed: true,
    message: `Removed ${normKey} from the safe-list. It will be encrypted on next import.`,
  };
}

/**
 * List the current safe-list, split into defaults and custom additions.
 *
 * @param configDir - The config directory path.
 * @returns Object with default keys, custom keys, and the full effective list.
 */
export function listSafeList(configDir: string): {
  defaults: readonly string[];
  custom: string[];
  effective: string[];
} {
  const config = getUserConfig(configDir);
  const custom = (config?.safeList ?? []).map((k) => k.toUpperCase());

  return {
    defaults: DEFAULT_SAFE_LIST,
    custom,
    effective: getEffectiveSafeList(configDir),
  };
}
