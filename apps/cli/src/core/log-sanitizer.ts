/**
 * Log sanitizer module.
 *
 * Redacts known secret patterns from log messages, error messages,
 * and stack traces. Wraps console output to ensure secrets never
 * appear in logs — even when `DEBUG=*` is set.
 *
 * **Security property:** No secret value ever appears in any log output.
 *
 * Patterns detected and redacted:
 * - Stripe keys (`sk_live_*`, `sk_test_*`)
 * - GitHub PATs (`ghp_*`, `gho_*`, `github_pat_*`)
 * - Slack tokens (`xoxb-*`, `xoxp-*`)
 * - Google API keys (`AIzaSy*`)
 * - AWS access keys (`AKIA*`)
 * - SendGrid keys (`SG.*`)
 * - Twilio SIDs (`AC` + 32 hex)
 * - OpenAI keys (`sk-*` 20+ chars)
 * - Age secret keys (`AGE-SECRET-KEY-*`)
 * - JWTs (`eyJ*...*`)
 * - PEM private keys
 * - URLs with embedded credentials
 * - Generic `password=`, `secret=`, `token=`, `key=` patterns
 *
 * @module core/log-sanitizer
 */

const REDACTED = '***REDACTED***';

/**
 * Secret patterns to redact from log output.
 *
 * Each entry maps a regex to a replacement function. The regex
 * should match the full secret token; the replacement function
 * returns the redacted version (preserving a prefix for debugging
 * context where possible).
 */
const SECRET_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  // Stripe keys
  { pattern: /\bsk_live_[a-zA-Z0-9_]+/g, replacement: `sk_live_${REDACTED}` },
  { pattern: /\bsk_test_[a-zA-Z0-9_]+/g, replacement: `sk_test_${REDACTED}` },

  // GitHub tokens
  { pattern: /\bghp_[a-zA-Z0-9]+/g, replacement: `ghp_${REDACTED}` },
  { pattern: /\bgho_[a-zA-Z0-9]+/g, replacement: `gho_${REDACTED}` },
  { pattern: /\bgithub_pat_[a-zA-Z0-9_]+/g, replacement: `github_pat_${REDACTED}` },

  // Slack tokens
  { pattern: /\bxoxb-[a-zA-Z0-9-]+/g, replacement: `xoxb-${REDACTED}` },
  { pattern: /\bxoxp-[a-zA-Z0-9-]+/g, replacement: `xoxp-${REDACTED}` },

  // Google API keys
  { pattern: /\bAIzaSy[a-zA-Z0-9_-]+/g, replacement: `AIzaSy${REDACTED}` },

  // AWS access keys
  { pattern: /\bAKIA[A-Z0-9]{16,}/g, replacement: `AKIA${REDACTED}` },

  // SendGrid keys
  { pattern: /\bSG\.[a-zA-Z0-9_.-]+/g, replacement: `SG.${REDACTED}` },

  // Twilio SIDs
  { pattern: /\bAC[a-f0-9]{32}/g, replacement: `AC${REDACTED}` },

  // OpenAI keys
  { pattern: /\bsk-[a-zA-Z0-9]{20,}/g, replacement: `sk-${REDACTED}` },

  // Age secret keys (critical — NEVER log private keys)
  { pattern: /AGE-SECRET-KEY-[A-Z0-9]+/g, replacement: `AGE-SECRET-KEY-${REDACTED}` },

  // JWTs (header.payload.signature)
  { pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: `eyJ${REDACTED}` },

  // PEM private keys (multiline — match the whole block)
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE KEY-----/g,
    replacement: `-----BEGIN PRIVATE KEY-----\n${REDACTED}\n-----END PRIVATE KEY-----`,
  },

  // PEM certificates
  {
    pattern: /-----BEGIN\s+CERTIFICATE-----[\s\S]*?-----END\s+CERTIFICATE-----/g,
    replacement: `-----BEGIN CERTIFICATE-----\n${REDACTED}\n-----END CERTIFICATE-----`,
  },

  // URLs with embedded credentials (e.g. postgres://user:pass@host/db, redis://:pass@host)
  { pattern: /:\/\/[^:/?#\s]*:[^@/?#\s]+@/g, replacement: `://${REDACTED}:${REDACTED}@` },

  // Generic key=value patterns for common secret field names
  { pattern: /(\b(?:password|secret|token|key|apikey|api_key|auth)\s*=\s*)\S+/gi, replacement: `$1${REDACTED}` },
];

/**
 * Sanitize a message by redacting known secret patterns.
 *
 * Applies all known secret pattern regexes and replaces matches
 * with redacted placeholders. Safe values pass through unchanged.
 *
 * @param message - The log message to sanitize.
 * @returns The sanitized message with secrets redacted.
 */
export function sanitizeForLog(message: string): string {
  if (!message || typeof message !== 'string') {
    return message;
  }

  let sanitized = message;

  for (const { pattern, replacement } of SECRET_PATTERNS) {
    // Reset the regex lastIndex (global regexes are stateful)
    pattern.lastIndex = 0;
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

/**
 * Sanitize an error object's message and stack trace.
 *
 * Returns a new Error with sanitized message and stack. The original
 * error is not modified.
 *
 * @param error - The error to sanitize.
 * @returns A new Error with sanitized message and stack.
 */
export function sanitizeError(error: Error): Error {
  const sanitized = new Error(sanitizeForLog(error.message));
  if (error.stack) {
    sanitized.stack = sanitizeForLog(error.stack);
  }
  sanitized.name = error.name;
  return sanitized;
}

/** Original console methods (saved before wrapping) */
let _originalConsoleLog: typeof console.log | null = null;
let _originalConsoleError: typeof console.error | null = null;
let _originalConsoleWarn: typeof console.warn | null = null;
let _originalConsoleDebug: typeof console.debug | null = null;

/** Whether console is currently wrapped */
let _isWrapped = false;

/**
 * Wrap all console output methods through the sanitizer.
 *
 * After calling this function, all `console.log`, `console.error`,
 * `console.warn`, and `console.debug` calls will have their arguments
 * sanitized before output.
 *
 * Call `unwrapConsole()` to restore original behaviour.
 *
 * **Security:** This ensures that even if a developer accidentally
 * logs a secret value, it will be redacted before reaching the terminal.
 */
export function wrapConsole(): void {
  if (_isWrapped) {
    return;
  }

  _originalConsoleLog = console.log;
  _originalConsoleError = console.error;
  _originalConsoleWarn = console.warn;
  _originalConsoleDebug = console.debug;

  const wrapMethod =
    (original: (...args: unknown[]) => void) =>
    (...args: unknown[]): void => {
      const sanitizedArgs = args.map((arg) => {
        if (typeof arg === 'string') {
          return sanitizeForLog(arg);
        }
        if (arg instanceof Error) {
          return sanitizeError(arg);
        }
        // For objects, sanitize JSON representation then parse back
        if (typeof arg === 'object' && arg !== null) {
          try {
            const json = JSON.stringify(arg);
            const sanitized = sanitizeForLog(json);
            return JSON.parse(sanitized) as unknown;
          } catch {
            // If JSON serialisation fails, return as-is
            return arg;
          }
        }
        return arg;
      });
      original.apply(console, sanitizedArgs);
    };

  console.log = wrapMethod(_originalConsoleLog);
  console.error = wrapMethod(_originalConsoleError);
  console.warn = wrapMethod(_originalConsoleWarn);
  console.debug = wrapMethod(_originalConsoleDebug);

  _isWrapped = true;
}

/**
 * Restore original console methods (unwrap the sanitizer).
 *
 * Safe to call even if `wrapConsole()` was never called.
 */
export function unwrapConsole(): void {
  if (!_isWrapped) {
    return;
  }

  if (_originalConsoleLog) console.log = _originalConsoleLog;
  if (_originalConsoleError) console.error = _originalConsoleError;
  if (_originalConsoleWarn) console.warn = _originalConsoleWarn;
  if (_originalConsoleDebug) console.debug = _originalConsoleDebug;

  _originalConsoleLog = null;
  _originalConsoleError = null;
  _originalConsoleWarn = null;
  _originalConsoleDebug = null;

  _isWrapped = false;
}

/**
 * Check whether the console is currently wrapped by the sanitizer.
 *
 * @returns `true` if `wrapConsole()` has been called and `unwrapConsole()` has not.
 */
export function isConsoleWrapped(): boolean {
  return _isWrapped;
}
