/**
 * Path validation module.
 *
 * Validates and canonicalises project paths to prevent path traversal
 * attacks and restrict operations to safe directories (within $HOME
 * or explicitly approved locations).
 *
 * @module core/path-validator
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Blocked directory prefixes that are never valid project paths.
 * These are system directories that should never be tracked.
 */
const BLOCKED_PREFIXES = [
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/var',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/lib',
  '/lib64',
  '/root',
];

/**
 * Canonicalise a path string.
 *
 * Resolves `~` to the home directory, normalises `.` and `..` segments,
 * and returns an absolute path. Does NOT follow symlinks — use
 * `fs.realpathSync` separately if you need the real path.
 *
 * @param p - The path to canonicalise (may contain `~`).
 * @returns The resolved absolute path.
 */
export function canonicalize(p: string): string {
  if (!p || p.trim().length === 0) {
    throw new Error('Path cannot be empty.');
  }

  let resolved = p.trim();

  // Resolve ~ to home directory (respects CTX_SYNC_HOME for testing)
  const homeDir = process.env['CTX_SYNC_HOME'] ?? os.homedir();
  if (resolved === '~') {
    resolved = homeDir;
  } else if (resolved.startsWith('~/')) {
    resolved = path.join(homeDir, resolved.slice(2));
  }

  // Resolve to absolute path (normalises .. and .)
  resolved = path.resolve(resolved);

  return resolved;
}

/**
 * Validate that a project path is safe to use.
 *
 * A path is valid if ALL of the following are true:
 * - It is non-empty and resolves to an absolute path.
 * - After canonicalisation, it is within the user's home directory.
 * - It does not land inside a blocked system directory.
 * - If the path exists and is a symlink, the symlink target is also
 *   within the home directory.
 *
 * @param p - The path to validate (may contain `~`).
 * @returns The canonicalised, validated absolute path.
 * @throws If the path is outside the home directory, in a blocked
 *         directory, or a symlink pointing outside the home directory.
 */
export function validateProjectPath(p: string): string {
  const homeDir = process.env['CTX_SYNC_HOME'] ?? os.homedir();
  const resolved = canonicalize(p);

  // Must be within home directory (checked first — paths inside the
  // effective home are allowed even if they happen to sit under a
  // system prefix, e.g. during tests on macOS where $TMPDIR is /var/…).
  const isWithinHome =
    resolved.startsWith(homeDir + '/') || resolved === homeDir;

  if (!isWithinHome) {
    // Provide a more specific error for known system directories
    for (const blocked of BLOCKED_PREFIXES) {
      if (resolved === blocked || resolved.startsWith(blocked + '/')) {
        throw new Error(
          `Path must be within home directory. Blocked path: ${resolved}\n` +
            `System directories like ${blocked}/ are not allowed.`,
        );
      }
    }

    throw new Error(
      `Path must be within home directory.\n` +
        `  Path: ${resolved}\n` +
        `  Home: ${homeDir}\n` +
        `Only paths under your home directory are allowed.`,
    );
  }

  // If the path exists, check for symlinks pointing outside home
  if (fs.existsSync(resolved)) {
    const stats = fs.lstatSync(resolved);
    if (stats.isSymbolicLink()) {
      let realTarget: string;
      try {
        realTarget = fs.realpathSync(resolved);
      } catch {
        throw new Error(
          `Cannot resolve symlink: ${resolved}\n` +
            'Symlinks must point to a valid location within the home directory.',
        );
      }

      // Compare using the real home path too (on macOS /var → /private/var)
      let realHome: string;
      try {
        realHome = fs.realpathSync(homeDir);
      } catch {
        realHome = homeDir;
      }

      const targetInHome =
        realTarget.startsWith(homeDir + '/') ||
        realTarget === homeDir ||
        realTarget.startsWith(realHome + '/') ||
        realTarget === realHome;

      if (!targetInHome) {
        throw new Error(
          `Symlink target outside allowed directory.\n` +
            `  Symlink: ${resolved}\n` +
            `  Target: ${realTarget}\n` +
            `Symlinks must point to a location within the home directory.`,
        );
      }
    }
  }

  return resolved;
}
