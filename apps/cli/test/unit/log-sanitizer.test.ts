import {
  sanitizeForLog,
  sanitizeError,
  wrapConsole,
  unwrapConsole,
  isConsoleWrapped,
} from '../../src/core/log-sanitizer.js';

describe('Log Sanitizer', () => {
  afterEach(() => {
    // Always restore console after each test
    unwrapConsole();
  });

  // ── sanitizeForLog ──────────────────────────────────────

  describe('sanitizeForLog()', () => {
    it('should pass safe values through unchanged', () => {
      expect(sanitizeForLog('hello world')).toBe('hello world');
      expect(sanitizeForLog('NODE_ENV=development')).toBe('NODE_ENV=development');
      expect(sanitizeForLog('Port 3000 is open')).toBe('Port 3000 is open');
      expect(sanitizeForLog('')).toBe('');
    });

    it('should handle non-string input gracefully', () => {
      expect(sanitizeForLog(null as unknown as string)).toBe(null);
      expect(sanitizeForLog(undefined as unknown as string)).toBe(undefined);
    });

    // ── Stripe keys ──
    it('should redact Stripe live keys', () => {
      const msg = 'Using key sk_live_4eC39HqLyjWDarjtT1zdp7dc';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('4eC39HqLyjWDarjtT1zdp7dc');
      expect(result).toContain('sk_live_***REDACTED***');
    });

    it('should redact Stripe test keys', () => {
      const msg = 'Using key sk_test_abc123xyz';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('abc123xyz');
      expect(result).toContain('sk_test_***REDACTED***');
    });

    // ── GitHub tokens ──
    it('should redact GitHub PATs (ghp_)', () => {
      const msg = 'Authenticated with ghp_ABCDEFghijklmnopqrstuvwxyz1234567890';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('ABCDEFghijklmnopqrstuvwxyz');
      expect(result).toContain('ghp_***REDACTED***');
    });

    it('should redact GitHub OAuth tokens (gho_)', () => {
      const msg = 'Token: gho_xxxxxxxxxxxxxxxxxx';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('xxxxxxxxxxxxxxxxxx');
      expect(result).toContain('gho_***REDACTED***');
    });

    it('should redact GitHub fine-grained PATs', () => {
      const msg = 'Using github_pat_XXXXXXXXXXXXXXXXXXXX';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('XXXXXXXXXXXXXXXXXXXX');
      expect(result).toContain('github_pat_***REDACTED***');
    });

    // ── Slack tokens ──
    it('should redact Slack bot tokens', () => {
      const msg = 'Bot token: xoxb-1234-5678-abcdefghij';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('1234-5678-abcdefghij');
      expect(result).toContain('xoxb-***REDACTED***');
    });

    it('should redact Slack user tokens', () => {
      const msg = 'User token: xoxp-1234-5678-abcdefghij';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('1234-5678-abcdefghij');
      expect(result).toContain('xoxp-***REDACTED***');
    });

    // ── Google API keys ──
    it('should redact Google API keys', () => {
      const msg = 'Key: AIzaSyA_example_key_1234';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('A_example_key_1234');
      expect(result).toContain('AIzaSy***REDACTED***');
    });

    // ── AWS access keys ──
    it('should redact AWS access keys', () => {
      const msg = 'Access key: AKIAIOSFODNN7EXAMPLE';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('IOSFODNN7EXAMPLE');
      expect(result).toContain('AKIA***REDACTED***');
    });

    // ── SendGrid keys ──
    it('should redact SendGrid keys', () => {
      const msg = 'Key: SG.abcdef123456.xyz789';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('abcdef123456');
      expect(result).toContain('SG.***REDACTED***');
    });

    // ── Twilio SIDs ──
    it('should redact Twilio account SIDs', () => {
      const msg = 'Account: AC1234567890abcdef1234567890abcdef';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('1234567890abcdef1234567890abcdef');
      expect(result).toContain('AC***REDACTED***');
    });

    // ── OpenAI keys ──
    it('should redact OpenAI keys', () => {
      const msg = 'API: sk-abcdefghijklmnopqrstuvwxyz';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
      expect(result).toContain('sk-***REDACTED***');
    });

    // ── Age secret keys ──
    it('should redact Age secret keys', () => {
      const msg = 'Private: AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQTESTKEY';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('1QQQQQQQQQQQQQQQQQQQTESTKEY');
      expect(result).toContain('AGE-SECRET-KEY-***REDACTED***');
    });

    // ── JWTs ──
    it('should redact JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const msg = `Bearer ${jwt}`;
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('eyJzdWIiOiIxMjM0NTY3ODkwIn0');
      expect(result).toContain('eyJ***REDACTED***');
    });

    // ── PEM keys ──
    it('should redact PEM private keys', () => {
      const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';
      const msg = `Key file contains: ${pem}`;
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('MIIEvgIBADANBg');
      expect(result).toContain('***REDACTED***');
    });

    it('should redact RSA private keys', () => {
      const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCA...\n-----END RSA PRIVATE KEY-----';
      const msg = `Key: ${pem}`;
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('MIIEowIBAAKCA');
      expect(result).toContain('***REDACTED***');
    });

    // ── URLs with credentials ──
    it('should redact URLs with embedded credentials', () => {
      const msg = 'Connecting to postgres://admin:s3cretpass@db.example.com:5432/mydb';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('admin');
      expect(result).not.toContain('s3cretpass');
      expect(result).toContain('***REDACTED***');
    });

    it('should redact Redis URLs with credentials', () => {
      const msg = 'Redis: redis://:mysecret@redis-server:6379';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('mysecret');
      expect(result).toContain('***REDACTED***');
    });

    // ── Generic key=value ──
    it('should redact password=value patterns', () => {
      const msg = 'Config: password=supersecret123';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('supersecret123');
      expect(result).toContain('password=***REDACTED***');
    });

    it('should redact secret=value patterns', () => {
      const msg = 'Header: secret=abc123def456';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('abc123def456');
      expect(result).toContain('secret=***REDACTED***');
    });

    it('should redact token=value patterns', () => {
      const msg = 'Auth token=mytoken123';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('mytoken123');
      expect(result).toContain('token=***REDACTED***');
    });

    // ── Multiple secrets in one message ──
    it('should redact multiple secrets in a single message', () => {
      const msg = 'Stripe: sk_live_abc123, GitHub: ghp_def456, AWS: AKIAIOSFODNN7EXAMPLE';
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('abc123');
      expect(result).not.toContain('def456');
      expect(result).not.toContain('IOSFODNN7EXAMPLE');
      expect(result).toContain('sk_live_***REDACTED***');
      expect(result).toContain('ghp_***REDACTED***');
      expect(result).toContain('AKIA***REDACTED***');
    });

    // ── Certificates ──
    it('should redact PEM certificates', () => {
      const cert = '-----BEGIN CERTIFICATE-----\nMIIDXTCCAkWgAwIBAgIJ...\n-----END CERTIFICATE-----';
      const msg = `Cert: ${cert}`;
      const result = sanitizeForLog(msg);
      expect(result).not.toContain('MIIDXTCCAkWgAwIBAgIJ');
      expect(result).toContain('***REDACTED***');
    });
  });

  // ── sanitizeError ──────────────────────────────────────

  describe('sanitizeError()', () => {
    it('should sanitize error message', () => {
      const err = new Error('Failed with key sk_live_abc123');
      const sanitized = sanitizeError(err);
      expect(sanitized.message).not.toContain('abc123');
      expect(sanitized.message).toContain('sk_live_***REDACTED***');
    });

    it('should sanitize error stack trace', () => {
      const err = new Error('Error with ghp_secret123');
      // Stack typically contains the message
      const sanitized = sanitizeError(err);
      expect(sanitized.stack ?? '').not.toContain('ghp_secret123');
    });

    it('should preserve error name', () => {
      const err = new TypeError('Bad key sk_live_xyz');
      const sanitized = sanitizeError(err);
      expect(sanitized.name).toBe('TypeError');
    });

    it('should not modify the original error', () => {
      const err = new Error('Key: sk_live_original');
      sanitizeError(err);
      expect(err.message).toContain('sk_live_original');
    });
  });

  // ── wrapConsole / unwrapConsole ─────────────────────────

  describe('wrapConsole() / unwrapConsole()', () => {
    it('should report wrapped state correctly', () => {
      expect(isConsoleWrapped()).toBe(false);
      wrapConsole();
      expect(isConsoleWrapped()).toBe(true);
      unwrapConsole();
      expect(isConsoleWrapped()).toBe(false);
    });

    it('should be idempotent — wrapping twice does not double-wrap', () => {
      wrapConsole();
      wrapConsole();
      expect(isConsoleWrapped()).toBe(true);
      unwrapConsole();
      expect(isConsoleWrapped()).toBe(false);
    });

    it('should unwrap safely when never wrapped', () => {
      expect(() => unwrapConsole()).not.toThrow();
    });

    it('should sanitize console.log output', () => {
      const captured: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      };

      wrapConsole();
      console.log('Stripe key: sk_live_testkey123');
      unwrapConsole();

      console.log = originalLog;

      expect(captured.length).toBe(1);
      expect(captured[0]).not.toContain('testkey123');
      expect(captured[0]).toContain('sk_live_***REDACTED***');
    });

    it('should sanitize console.error output', () => {
      const captured: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      };

      wrapConsole();
      console.error('Auth failed for ghp_secrettoken');
      unwrapConsole();

      console.error = originalError;

      expect(captured.length).toBe(1);
      expect(captured[0]).not.toContain('ghp_secrettoken');
      expect(captured[0]).toContain('ghp_***REDACTED***');
    });

    it('should sanitize console.warn output', () => {
      const captured: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      };

      wrapConsole();
      console.warn('AWS key: AKIAIOSFODNN7EXAMPLE');
      unwrapConsole();

      console.warn = originalWarn;

      expect(captured.length).toBe(1);
      expect(captured[0]).not.toContain('IOSFODNN7EXAMPLE');
      expect(captured[0]).toContain('AKIA***REDACTED***');
    });

    it('should sanitize console.debug output', () => {
      const captured: string[] = [];
      const originalDebug = console.debug;
      console.debug = (...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      };

      wrapConsole();
      console.debug('Debug AGE-SECRET-KEY-1ABC123');
      unwrapConsole();

      console.debug = originalDebug;

      expect(captured.length).toBe(1);
      expect(captured[0]).not.toContain('1ABC123');
      expect(captured[0]).toContain('AGE-SECRET-KEY-***REDACTED***');
    });

    it('should sanitize object arguments via JSON', () => {
      const captured: unknown[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        captured.push(...args);
      };

      wrapConsole();
      console.log({ apiKey: 'sk_live_objecttest123' });
      unwrapConsole();

      console.log = originalLog;

      const output = JSON.stringify(captured[0]);
      expect(output).not.toContain('objecttest123');
      expect(output).toContain('***REDACTED***');
    });
  });
});
