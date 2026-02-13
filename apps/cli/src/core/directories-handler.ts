/**
 * Directories handler module.
 *
 * Tracks recent working directories and pinned directories associated
 * with a user's development workflow. State is persisted in
 * `directories.age` (encrypted).
 *
 * **Path validation:** All directory paths are validated through the
 * path-validator module to prevent path traversal attacks.
 *
 * @module core/directories-handler
 */

import type { RecentDirectory, DirectoryState } from '@ctx-sync/shared';
import { readState, writeState } from './state-manager.js';
import { validateProjectPath } from './path-validator.js';

// ─── Constants ────────────────────────────────────────────────────────────

/**
 * Maximum number of recent directories to retain.
 * Older, less-frequent entries are pruned when this limit is exceeded.
 */
export const MAX_RECENT_DIRS = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build an empty `DirectoryState`.
 */
function emptyState(): DirectoryState {
  return { recentDirs: [], pinnedDirs: [] };
}

/**
 * Sort recent directories by frequency (descending), then by lastVisit
 * (most recent first).
 */
function sortRecent(dirs: RecentDirectory[]): RecentDirectory[] {
  return [...dirs].sort((a, b) => {
    if (b.frequency !== a.frequency) return b.frequency - a.frequency;
    return b.lastVisit.localeCompare(a.lastVisit);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Load directory state from encrypted storage.
 *
 * @param syncDir    - The sync directory (e.g. ~/.context-sync).
 * @param privateKey - Age private key for decryption.
 * @returns The decrypted `DirectoryState`, or an empty state if the
 *          file does not exist.
 */
export async function loadDirectories(
  syncDir: string,
  privateKey: string,
): Promise<DirectoryState> {
  const state = await readState<DirectoryState>(
    syncDir,
    privateKey,
    'directories',
  );
  return state ?? emptyState();
}

/**
 * Save (overwrite) the entire directory state.
 *
 * @param syncDir   - The sync directory.
 * @param state     - The complete `DirectoryState` to persist.
 * @param publicKey - Age public key for encryption.
 */
export async function saveDirectories(
  syncDir: string,
  state: DirectoryState,
  publicKey: string,
): Promise<void> {
  await writeState(syncDir, state, publicKey, 'directories');
}

/**
 * Record a directory visit.
 *
 * - If the directory already exists in the recent list, its frequency is
 *   incremented and its lastVisit timestamp updated.
 * - If new, it is added with frequency 1.
 * - The list is pruned to `MAX_RECENT_DIRS` after insertion.
 * - The path is validated against the path-validator to reject traversal
 *   attacks.
 *
 * @param syncDir    - The sync directory.
 * @param dirPath    - The directory path to record (will be validated).
 * @param publicKey  - Age public key for encryption.
 * @param privateKey - Age private key for decryption.
 * @throws If the path fails validation.
 */
export async function visitDirectory(
  syncDir: string,
  dirPath: string,
  publicKey: string,
  privateKey: string,
): Promise<void> {
  // Validate the path — throws on traversal / blocked paths
  const validatedPath = validateProjectPath(dirPath);

  const state = await loadDirectories(syncDir, privateKey);
  const now = new Date().toISOString();

  const existing = state.recentDirs.find((d) => d.path === validatedPath);
  if (existing) {
    existing.frequency += 1;
    existing.lastVisit = now;
  } else {
    state.recentDirs.push({
      path: validatedPath,
      frequency: 1,
      lastVisit: now,
    });
  }

  // Sort and prune
  state.recentDirs = sortRecent(state.recentDirs).slice(0, MAX_RECENT_DIRS);

  await saveDirectories(syncDir, state, publicKey);
}

/**
 * Pin a directory.
 *
 * Pinned directories are always shown at the top of directory listings
 * and are not subject to the recent-directory pruning limit.
 *
 * @param syncDir    - The sync directory.
 * @param dirPath    - The directory path to pin (will be validated).
 * @param publicKey  - Age public key for encryption.
 * @param privateKey - Age private key for decryption.
 * @returns `true` if the directory was newly pinned, `false` if already pinned.
 * @throws If the path fails validation.
 */
export async function pinDirectory(
  syncDir: string,
  dirPath: string,
  publicKey: string,
  privateKey: string,
): Promise<boolean> {
  const validatedPath = validateProjectPath(dirPath);

  const state = await loadDirectories(syncDir, privateKey);

  if (state.pinnedDirs.includes(validatedPath)) {
    return false;
  }

  state.pinnedDirs.push(validatedPath);
  await saveDirectories(syncDir, state, publicKey);
  return true;
}

/**
 * Unpin a directory.
 *
 * @param syncDir    - The sync directory.
 * @param dirPath    - The directory path to unpin (will be validated).
 * @param publicKey  - Age public key for encryption.
 * @param privateKey - Age private key for decryption.
 * @returns `true` if the directory was unpinned, `false` if it was not pinned.
 * @throws If the path fails validation.
 */
export async function unpinDirectory(
  syncDir: string,
  dirPath: string,
  publicKey: string,
  privateKey: string,
): Promise<boolean> {
  const validatedPath = validateProjectPath(dirPath);

  const state = await loadDirectories(syncDir, privateKey);
  const before = state.pinnedDirs.length;
  state.pinnedDirs = state.pinnedDirs.filter((p) => p !== validatedPath);

  if (state.pinnedDirs.length === before) {
    return false;
  }

  await saveDirectories(syncDir, state, publicKey);
  return true;
}

/**
 * Remove a directory from the recent list (does not affect pinned).
 *
 * @param syncDir    - The sync directory.
 * @param dirPath    - The directory path to remove.
 * @param publicKey  - Age public key for encryption.
 * @param privateKey - Age private key for decryption.
 * @returns `true` if the directory was removed, `false` if not found.
 */
export async function removeRecentDirectory(
  syncDir: string,
  dirPath: string,
  publicKey: string,
  privateKey: string,
): Promise<boolean> {
  const validatedPath = validateProjectPath(dirPath);

  const state = await loadDirectories(syncDir, privateKey);
  const before = state.recentDirs.length;
  state.recentDirs = state.recentDirs.filter((d) => d.path !== validatedPath);

  if (state.recentDirs.length === before) {
    return false;
  }

  await saveDirectories(syncDir, state, publicKey);
  return true;
}

/**
 * Get the most-visited recent directories.
 *
 * @param syncDir    - The sync directory.
 * @param privateKey - Age private key.
 * @param limit      - Maximum number to return (default: 10).
 * @returns Sorted recent directories (most-visited first).
 */
export async function getTopDirectories(
  syncDir: string,
  privateKey: string,
  limit = 10,
): Promise<RecentDirectory[]> {
  const state = await loadDirectories(syncDir, privateKey);
  return sortRecent(state.recentDirs).slice(0, limit);
}

/**
 * Get all pinned directories.
 *
 * @param syncDir    - The sync directory.
 * @param privateKey - Age private key.
 * @returns Array of pinned directory paths.
 */
export async function getPinnedDirectories(
  syncDir: string,
  privateKey: string,
): Promise<string[]> {
  const state = await loadDirectories(syncDir, privateKey);
  return [...state.pinnedDirs];
}

/**
 * Validate a directory path for use in directory state.
 *
 * Thin wrapper around `validateProjectPath` exposed for external callers
 * who want to validate before calling other functions.
 *
 * @param dirPath - The directory path to validate.
 * @returns The canonicalised, validated path.
 * @throws If the path is invalid.
 */
export function validateDirectoryPath(dirPath: string): string {
  return validateProjectPath(dirPath);
}
