/**
 * Shared constants for ctx-sync.
 */

/** Current CLI version */
export const VERSION = '1.3.2';

/** Default safe-list: env var keys that MAY be stored as plaintext (with --allow-plain) */
export const DEFAULT_SAFE_LIST: readonly string[] = [
  'NODE_ENV',
  'PORT',
  'HOST',
  'DEBUG',
  'LOG_LEVEL',
  'TZ',
  'LANG',
  'SHELL',
  'EDITOR',
  'TERM',
  'COLORTERM',
  'CI',
  'VERBOSE',
] as const;

/** State file names (encrypted) */
export const STATE_FILES = {
  STATE: 'state.age',
  ENV_VARS: 'env-vars.age',
  DOCKER_STATE: 'docker-state.age',
  MENTAL_CONTEXT: 'mental-context.age',
  SERVICES: 'services.age',
  DIRECTORIES: 'directories.age',
  MANIFEST: 'manifest.json',
} as const;

/** Local config directory name (under ~/.config/) — NEVER synced to Git */
export const CONFIG_DIR = 'ctx-sync';

/** Sync directory name (under ~/) — Git repo for syncing */
export const SYNC_DIR = '.context-sync';
