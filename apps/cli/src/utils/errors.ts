/**
 * Custom error classes for ctx-sync.
 *
 * Each error class provides:
 * - A user-friendly message with suggested fix.
 * - An error code for programmatic handling.
 * - Stack traces only shown with `--verbose` or `DEBUG=*`.
 *
 * @module utils/errors
 */

/** Base class for all ctx-sync errors with user-friendly messaging. */
export class CtxSyncError extends Error {
  /** Machine-readable error code (e.g. 'ENCRYPTION_FAILED'). */
  readonly code: string;

  /** Suggested fix for the user. */
  readonly suggestion: string;

  constructor(message: string, code: string, suggestion: string) {
    super(message);
    this.name = 'CtxSyncError';
    this.code = code;
    this.suggestion = suggestion;
  }

  /** Format a user-friendly error message (no stack trace). */
  toFriendlyString(): string {
    const lines: string[] = [];
    lines.push(`Error: ${this.message}`);
    if (this.suggestion) {
      lines.push('');
      lines.push(`  Suggested fix: ${this.suggestion}`);
    }
    return lines.join('\n');
  }
}

/** Encryption/decryption failures. */
export class EncryptionError extends CtxSyncError {
  constructor(message: string, suggestion?: string) {
    super(
      message,
      'ENCRYPTION_FAILED',
      suggestion ?? 'Check your encryption key with `ctx-sync key verify`.',
    );
    this.name = 'EncryptionError';
  }
}

/** Git sync failures. */
export class SyncError extends CtxSyncError {
  constructor(message: string, suggestion?: string) {
    super(
      message,
      'SYNC_FAILED',
      suggestion ?? 'Run `ctx-sync init` to set up the sync repository.',
    );
    this.name = 'SyncError';
  }
}

/** Configuration errors (missing config, invalid values). */
export class ConfigError extends CtxSyncError {
  constructor(message: string, suggestion?: string) {
    super(
      message,
      'CONFIG_ERROR',
      suggestion ??
        'Run `ctx-sync init` to create a fresh configuration, or check ~/.config/ctx-sync/.',
    );
    this.name = 'ConfigError';
  }
}

/** Security violations (bad permissions, insecure transport, etc.). */
export class SecurityError extends CtxSyncError {
  constructor(message: string, suggestion?: string) {
    super(
      message,
      'SECURITY_ERROR',
      suggestion ?? 'Run `ctx-sync audit` to diagnose security issues.',
    );
    this.name = 'SecurityError';
  }
}

/** Project not found or invalid project state. */
export class ProjectError extends CtxSyncError {
  constructor(message: string, suggestion?: string) {
    super(
      message,
      'PROJECT_ERROR',
      suggestion ?? 'Run `ctx-sync list` to see tracked projects.',
    );
    this.name = 'ProjectError';
  }
}

/** Edge-case errors (disk full, permission denied, corrupted data). */
export class EdgeCaseError extends CtxSyncError {
  constructor(message: string, suggestion?: string) {
    super(
      message,
      'EDGE_CASE_ERROR',
      suggestion ?? 'Check system resources and file permissions.',
    );
    this.name = 'EdgeCaseError';
  }
}

/**
 * Determine whether verbose/debug output should be shown.
 *
 * Returns `true` if `--verbose` was passed or `DEBUG` env is set.
 */
export function isVerbose(): boolean {
  const args = process.argv;
  return (
    args.includes('--verbose') ||
    args.includes('-v') ||
    !!process.env['DEBUG']
  );
}

/**
 * Map common raw errors to ctx-sync error classes.
 *
 * Takes an unknown thrown value and wraps it in the most appropriate
 * CtxSyncError subclass when possible.
 *
 * @param err - The raw thrown value.
 * @returns A CtxSyncError (or the original if already one).
 */
export function classifyError(err: unknown): CtxSyncError {
  if (err instanceof CtxSyncError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lowerMsg = message.toLowerCase();

  // Encryption / decryption problems
  // Note: avoid matching "age" alone — it also appears in "Invalid Age public key format".
  // Only match "age:" (library prefix) or "age ciphertext" patterns.
  if (
    lowerMsg.includes('decrypt') ||
    lowerMsg.includes('age:') ||
    lowerMsg.includes('age ciphertext') ||
    lowerMsg.includes('ciphertext') ||
    lowerMsg.includes('encrypted')
  ) {
    return new EncryptionError(
      'Failed to decrypt state file.',
      'Your encryption key may be wrong or the file may be corrupted.\n' +
        '  Try: ctx-sync key verify',
    );
  }

  // Missing key
  if (
    lowerMsg.includes('key.txt') ||
    lowerMsg.includes('key file') ||
    lowerMsg.includes('no such file') && lowerMsg.includes('key')
  ) {
    return new ConfigError(
      'Encryption key not found.',
      'Run `ctx-sync init` to generate a new key, or `ctx-sync init --restore` to restore an existing one.',
    );
  }

  // Git remote permission denied (push/pull auth failure)
  if (
    (lowerMsg.includes('permission') || lowerMsg.includes('denied')) &&
    (lowerMsg.includes('remote') || lowerMsg.includes('git') || lowerMsg.includes('push') || lowerMsg.includes('fatal'))
  ) {
    return new SecurityError(
      'Git remote access denied.',
      'The current machine may not have push/pull access to the sync repo.\n' +
        '  Check: cd ~/.context-sync && git remote -v\n' +
        '  Ensure this machine is authenticated with a GitHub account that has access.',
    );
  }

  // File system permissions (EACCES/EPERM — not git related)
  if (
    lowerMsg.includes('eacces') ||
    lowerMsg.includes('eperm')
  ) {
    return new SecurityError(
      'Permission denied.',
      'Check file permissions. Key file should be 600, config dir should be 700.\n' +
        '  Try: chmod 600 ~/.config/ctx-sync/key.txt',
    );
  }

  // Disk space
  if (lowerMsg.includes('enospc') || lowerMsg.includes('no space')) {
    return new EdgeCaseError(
      'Disk is full — cannot write state files.',
      'Free up disk space and try again.',
    );
  }

  // Transport security (check before generic git errors)
  if (lowerMsg.includes('insecure') || lowerMsg.includes('http://')) {
    return new SecurityError(
      message,
      'Use SSH (git@...) or HTTPS (https://...) for your remote URL.\n' +
        '  Try: git remote set-url origin <secure-url>',
    );
  }

  // Git errors
  if (
    lowerMsg.includes('git') ||
    lowerMsg.includes('remote') ||
    lowerMsg.includes('repository')
  ) {
    return new SyncError(
      message,
      'Ensure Git is installed and the sync repo is initialized.\n' +
        '  Try: ctx-sync init',
    );
  }

  // Path validation
  if (
    lowerMsg.includes('path') &&
    (lowerMsg.includes('outside') || lowerMsg.includes('traversal'))
  ) {
    return new SecurityError(
      message,
      'Project paths must be within your home directory.',
    );
  }

  // Fallback: wrap as a generic CtxSyncError
  return new CtxSyncError(
    message,
    'UNKNOWN_ERROR',
    'If this persists, run with --verbose for more details or file an issue.',
  );
}

/**
 * Format an error for user-facing output.
 *
 * In normal mode: shows only the friendly message + suggestion.
 * In verbose mode: also shows the full stack trace.
 *
 * @param err - The error to format.
 * @returns Formatted string for console output.
 */
export function formatError(err: unknown): string {
  const ctxErr = classifyError(err);
  const lines: string[] = [];

  lines.push(ctxErr.toFriendlyString());

  if (isVerbose() && ctxErr.stack) {
    lines.push('');
    lines.push('Stack trace:');
    lines.push(ctxErr.stack);
  }

  return lines.join('\n');
}

/**
 * Wrap a command handler with user-friendly error handling.
 *
 * Catches any thrown error, classifies it, and prints a friendly message.
 * Sets `process.exitCode = 1` on failure.
 *
 * @param fn - The async command handler function.
 * @returns A wrapped function safe for use as a Commander action.
 */
export function withErrorHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args: T): Promise<void> => {
    try {
      await fn(...args);
    } catch (err: unknown) {
      console.error(formatError(err));
      process.exitCode = 1;
    }
  };
}
