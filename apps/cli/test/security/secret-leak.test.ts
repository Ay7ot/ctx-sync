import {
  sanitizeForLog,
  sanitizeError,
  wrapConsole,
  unwrapConsole,
} from '../../src/core/log-sanitizer.js';

/**
 * Security: Secret Leak Prevention Tests
 *
 * Verifies that no secret value ever appears in any log output,
 * error message, or stack trace — even when DEBUG=* is enabled.
 */
describe('Security: Secret Leak Prevention', () => {
  afterEach(() => {
    unwrapConsole();
  });

  // ── With DEBUG=* no secrets in output ──────────────────

  describe('DEBUG mode does not leak secrets', () => {
    it('should not expose secrets with DEBUG=* when console is wrapped', () => {
      const captured: string[] = [];
      const originalLog = console.log;
      const originalDebug = console.debug;

      console.log = (...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      };
      console.debug = (...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      };

      wrapConsole();

      // Simulate DEBUG-level logging with various secret types
      console.debug('Processing key sk_live_4eC39HqLyjWDarjtT1zdp7dc');
      console.debug('GitHub: ghp_ABCDEFghijklmnopqrst');
      console.debug('AWS: AKIAIOSFODNN7EXAMPLE');
      console.debug('Age: AGE-SECRET-KEY-1QQQQQQQQQQQTEST');
      console.log('Stripe test: sk_test_abc123');
      console.log('DB URL: postgres://admin:secret@db.com/app');

      unwrapConsole();
      console.log = originalLog;
      console.debug = originalDebug;

      const allOutput = captured.join('\n');

      // None of these secret values should appear
      expect(allOutput).not.toContain('4eC39HqLyjWDarjtT1zdp7dc');
      expect(allOutput).not.toContain('ABCDEFghijklmnopqrst');
      expect(allOutput).not.toContain('IOSFODNN7EXAMPLE');
      expect(allOutput).not.toContain('1QQQQQQQQQQQTEST');
      expect(allOutput).not.toContain('abc123');
      expect(allOutput).not.toContain('admin:secret');

      // Redaction markers should be present
      expect(allOutput).toContain('***REDACTED***');
    });
  });

  // ── Error messages do not contain secrets ──────────────

  describe('Error messages do not leak secrets', () => {
    it('should sanitize Stripe keys from errors', () => {
      const err = new Error('Encryption failed for key sk_live_SECRETVALUE123');
      const sanitized = sanitizeError(err);
      expect(sanitized.message).not.toContain('SECRETVALUE123');
    });

    it('should sanitize GitHub tokens from errors', () => {
      const err = new Error('Auth error with ghp_verysecrettoken');
      const sanitized = sanitizeError(err);
      expect(sanitized.message).not.toContain('verysecrettoken');
    });

    it('should sanitize Age private keys from errors', () => {
      const err = new Error('Key error: AGE-SECRET-KEY-1ABCDEFGHIJKLMNOP');
      const sanitized = sanitizeError(err);
      expect(sanitized.message).not.toContain('1ABCDEFGHIJKLMNOP');
    });

    it('should sanitize database URLs from errors', () => {
      const err = new Error('Connection failed: postgres://user:p4ssw0rd@host/db');
      const sanitized = sanitizeError(err);
      expect(sanitized.message).not.toContain('p4ssw0rd');
    });

    it('should sanitize JWTs from errors', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.signature123';
      const err = new Error(`Token invalid: ${jwt}`);
      const sanitized = sanitizeError(err);
      expect(sanitized.message).not.toContain('eyJzdWIiOiIxMjM0In0');
    });
  });

  // ── Stack traces do not contain secrets ──────────────

  describe('Stack traces do not leak secrets', () => {
    it('should sanitize secrets from stack traces', () => {
      const err = new Error('Failed with sk_live_stacksecret');
      const sanitized = sanitizeError(err);
      const stack = sanitized.stack ?? '';
      expect(stack).not.toContain('sk_live_stacksecret');
    });

    it('should sanitize Age keys from stack traces', () => {
      const err = new Error('Key load failed: AGE-SECRET-KEY-1STACKTEST');
      const sanitized = sanitizeError(err);
      const stack = sanitized.stack ?? '';
      expect(stack).not.toContain('AGE-SECRET-KEY-1STACKTEST');
    });

    it('should sanitize PEM keys from stack traces', () => {
      const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----';
      const err = new Error(`PEM parse error: ${pem}`);
      const sanitized = sanitizeError(err);
      const stack = sanitized.stack ?? '';
      expect(stack).not.toContain('MIIEvg');
    });
  });

  // ── All product-spec patterns are covered ──────────────

  describe('All secret patterns from product spec are redacted', () => {
    const secretPatterns = [
      { name: 'Stripe live', value: 'sk_live_4eC39HqLyjWDarjtT1zdp7dc' },
      { name: 'Stripe test', value: 'sk_test_4eC39HqLyjWDarjtT1zdp7dc' },
      { name: 'GitHub PAT', value: 'ghp_ABCDEFghijklmnopqrstuvwxyz' },
      { name: 'GitHub OAuth', value: 'gho_ABCDEFghijklmnopqrstuvwxyz' },
      { name: 'GitHub fine-grained', value: 'github_pat_XXXXXXXXXXXXXX' },
      { name: 'Slack bot', value: 'xoxb-123456789-123456789-abcdef' },
      { name: 'Slack user', value: 'xoxp-123456789-123456789-abcdef' },
      { name: 'Google API', value: 'AIzaSyA_example_key_1234' },
      { name: 'AWS access key', value: 'AKIAIOSFODNN7EXAMPLE' },
      { name: 'SendGrid', value: 'SG.abcdef123.xyz789012' },
      { name: 'OpenAI', value: 'sk-abcdefghijklmnopqrstuvwxyz' },
      { name: 'Age secret key', value: 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQTEST' },
    ];

    for (const { name, value } of secretPatterns) {
      it(`should redact ${name} token: ${value.slice(0, 10)}...`, () => {
        const msg = `Logging: ${value}`;
        const result = sanitizeForLog(msg);
        // The full token value must not appear
        expect(result).not.toContain(value);
        // A redaction marker must be present
        expect(result).toContain('***REDACTED***');
      });
    }
  });

  // ── Edge cases ──────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle empty strings', () => {
      expect(sanitizeForLog('')).toBe('');
    });

    it('should handle messages with no secrets', () => {
      const msg = 'Syncing 3 projects to remote...';
      expect(sanitizeForLog(msg)).toBe(msg);
    });

    it('should handle very long messages efficiently', () => {
      const longMsg = 'x'.repeat(100_000) + ' sk_live_hidden123 ' + 'y'.repeat(100_000);
      const result = sanitizeForLog(longMsg);
      expect(result).not.toContain('sk_live_hidden123');
      expect(result).toContain('sk_live_***REDACTED***');
    });

    it('should handle multiple occurrences of same pattern', () => {
      const msg = 'Key1: sk_live_abc, Key2: sk_live_def, Key3: sk_live_ghi';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('sk_live_abc');
      expect(result).not.toContain('sk_live_def');
      expect(result).not.toContain('sk_live_ghi');
      // All three should be redacted
      expect(result.match(/sk_live_\*\*\*REDACTED\*\*\*/g)?.length).toBe(3);
    });
  });
});
