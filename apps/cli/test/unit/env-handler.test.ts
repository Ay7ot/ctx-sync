/**
 * Unit tests for the env-handler core module.
 *
 * Covers: shouldEncrypt, hasHighEntropy, containsCredentialPattern,
 * parseEnvFile, validateKeyArg, importEnvVars, addEnvVar, listEnvVars.
 */

import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// --- Mock simple-git (needed by state-manager → git-sync) ---
const mockInit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockAdd = jest.fn<(files: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockCommit = jest
  .fn<(message: string) => Promise<{ commit: string }>>()
  .mockResolvedValue({ commit: 'abc123' });
const mockGetRemotes = jest
  .fn<() => Promise<Array<{ name: string; refs: { fetch: string; push: string } }>>>()
  .mockResolvedValue([]);
const mockAddRemote = jest
  .fn<(name: string, url: string) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockRemote = jest.fn<(args: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockStatus = jest
  .fn<
    () => Promise<{
      files: { path: string }[];
      staged: string[];
      created: string[];
      deleted: string[];
      ahead: number;
      behind: number;
      isClean: () => boolean;
    }>
  >()
  .mockResolvedValue({
    files: [],
    staged: ['env-vars.age', 'manifest.json'],
    created: [],
    deleted: [],
    ahead: 0,
    behind: 0,
    isClean: () => false,
  });

const mockSimpleGit = jest.fn().mockReturnValue({
  init: mockInit,
  add: mockAdd,
  commit: mockCommit,
  getRemotes: mockGetRemotes,
  addRemote: mockAddRemote,
  remote: mockRemote,
  status: mockStatus,
});

jest.unstable_mockModule('simple-git', () => ({
  simpleGit: mockSimpleGit,
  default: mockSimpleGit,
}));

// --- Now import modules under test ---
const {
  shouldEncrypt,
  hasHighEntropy,
  containsCredentialPattern,
  parseEnvFile,
  validateKeyArg,
  importEnvVars,
  addEnvVar,
  listEnvVars,
} = await import('../../src/core/env-handler.js');

const { generateKey } = await import('../../src/core/encryption.js');

describe('Env Handler Module', () => {
  // ─── shouldEncrypt ──────────────────────────────────────────────────
  describe('shouldEncrypt()', () => {
    it('should encrypt ALL values by default (not on safe-list)', () => {
      expect(shouldEncrypt('CUSTOM_VAR', 'any-value')).toBe(true);
      expect(shouldEncrypt('MY_SETTING', 'hello')).toBe(true);
      expect(shouldEncrypt('DATABASE_URL', 'postgres://localhost/db')).toBe(true);
      expect(shouldEncrypt('STRIPE_KEY', 'sk_live_abc123')).toBe(true);
      expect(shouldEncrypt('SECRET_TOKEN', 'some-token')).toBe(true);
    });

    it('should allow safe-listed keys to be plain', () => {
      expect(shouldEncrypt('NODE_ENV', 'development')).toBe(false);
      expect(shouldEncrypt('PORT', '3000')).toBe(false);
      expect(shouldEncrypt('DEBUG', 'true')).toBe(false);
      expect(shouldEncrypt('LOG_LEVEL', 'info')).toBe(false);
      expect(shouldEncrypt('HOST', 'localhost')).toBe(false);
      expect(shouldEncrypt('CI', 'true')).toBe(false);
      expect(shouldEncrypt('VERBOSE', '1')).toBe(false);
    });

    it('should encrypt safe-listed keys if value looks sensitive (high entropy)', () => {
      expect(shouldEncrypt('PORT', 'sk_live_4eC39HqLyjWDarjtT1zdp7dc')).toBe(true);
    });

    it('should encrypt safe-listed keys if value matches credential pattern', () => {
      expect(shouldEncrypt('NODE_ENV', 'ghp_xxxxxxxxxxxxxxxxxxxx')).toBe(true);
      expect(shouldEncrypt('DEBUG', 'sk_live_abc123')).toBe(true);
    });

    it('should be case-insensitive for key matching', () => {
      expect(shouldEncrypt('node_env', 'development')).toBe(false);
      expect(shouldEncrypt('port', '3000')).toBe(false);
    });

    it('should accept a custom safe-list', () => {
      const customSafeList = ['MY_SAFE_VAR'] as const;
      expect(shouldEncrypt('MY_SAFE_VAR', 'safe-value', customSafeList)).toBe(false);
      expect(shouldEncrypt('NODE_ENV', 'development', customSafeList)).toBe(true);
    });
  });

  // ─── hasHighEntropy ─────────────────────────────────────────────────
  describe('hasHighEntropy()', () => {
    it('should detect high-entropy strings (API keys / tokens)', () => {
      expect(hasHighEntropy('a8f3k9d2m5n7p1q4r6s0t8u3v5w7x9y')).toBe(true);
      expect(hasHighEntropy('sk_live_4eC39HqLyjWDarjtT1zdp7dc')).toBe(true);
    });

    it('should not flag low-entropy strings', () => {
      expect(hasHighEntropy('development')).toBe(false);
      expect(hasHighEntropy('true')).toBe(false);
      expect(hasHighEntropy('3000')).toBe(false);
      expect(hasHighEntropy('info')).toBe(false);
      expect(hasHighEntropy('localhost')).toBe(false);
    });

    it('should ignore short strings (< 16 chars)', () => {
      expect(hasHighEntropy('abc')).toBe(false);
      expect(hasHighEntropy('shortstring')).toBe(false);
      expect(hasHighEntropy('123456789012345')).toBe(false); // 15 chars
    });

    it('should not flag strings of all same character', () => {
      expect(hasHighEntropy('aaaaaaaaaaaaaaaa')).toBe(false); // 16 chars, zero entropy
    });
  });

  // ─── containsCredentialPattern ──────────────────────────────────────
  describe('containsCredentialPattern()', () => {
    it('should detect Stripe keys', () => {
      expect(containsCredentialPattern('sk_live_abc123')).toBe(true);
      expect(containsCredentialPattern('sk_test_abc123')).toBe(true);
    });

    it('should detect GitHub PAT', () => {
      expect(containsCredentialPattern('ghp_xxxxxxxxxxxxxxxx')).toBe(true);
    });

    it('should detect GitHub OAuth token', () => {
      expect(containsCredentialPattern('gho_xxxxxxxxxxxxxxxx')).toBe(true);
    });

    it('should detect GitHub fine-grained PAT', () => {
      expect(containsCredentialPattern('github_pat_xxxx')).toBe(true);
    });

    it('should detect Slack bot token', () => {
      expect(containsCredentialPattern('xoxb-1234-5678')).toBe(true);
    });

    it('should detect Slack user token', () => {
      expect(containsCredentialPattern('xoxp-1234-5678')).toBe(true);
    });

    it('should detect Google API key', () => {
      expect(containsCredentialPattern('AIzaSyA_example')).toBe(true);
    });

    it('should detect AWS access key', () => {
      expect(containsCredentialPattern('AKIAIOSFODNN7')).toBe(true);
    });

    it('should detect SendGrid key', () => {
      expect(containsCredentialPattern('SG.xxxxx')).toBe(true);
    });

    it('should detect OpenAI key', () => {
      expect(containsCredentialPattern('sk-xxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true);
    });

    it('should detect JWTs', () => {
      const jwt =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      expect(containsCredentialPattern(jwt)).toBe(true);
    });

    it('should detect PEM private keys', () => {
      expect(
        containsCredentialPattern('-----BEGIN PRIVATE KEY-----\nMIIEvg...'),
      ).toBe(true);
      expect(
        containsCredentialPattern('-----BEGIN RSA PRIVATE KEY-----\nMIIEow...'),
      ).toBe(true);
    });

    it('should detect URLs with embedded credentials', () => {
      expect(
        containsCredentialPattern('postgres://user:password@localhost:5432/db'),
      ).toBe(true);
      expect(
        containsCredentialPattern(
          'mongodb://admin:secret@cluster0.mongodb.net/db',
        ),
      ).toBe(true);
      expect(
        containsCredentialPattern('redis://:mysecret@redis-server:6379'),
      ).toBe(true);
    });

    it('should detect Twilio Account SID', () => {
      expect(
        containsCredentialPattern('AC' + 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4'),
      ).toBe(true);
    });

    it('should NOT flag safe values', () => {
      expect(containsCredentialPattern('development')).toBe(false);
      expect(containsCredentialPattern('3000')).toBe(false);
      expect(containsCredentialPattern('true')).toBe(false);
      expect(containsCredentialPattern('https://example.com')).toBe(false);
      expect(containsCredentialPattern('localhost')).toBe(false);
    });
  });

  // ─── parseEnvFile ───────────────────────────────────────────────────
  describe('parseEnvFile()', () => {
    it('should parse standard KEY=value pairs', () => {
      const result = parseEnvFile('FOO=bar\nBAZ=qux');
      expect(result).toEqual([
        { key: 'FOO', value: 'bar' },
        { key: 'BAZ', value: 'qux' },
      ]);
    });

    it('should skip comments', () => {
      const result = parseEnvFile('# This is a comment\nFOO=bar');
      expect(result).toEqual([{ key: 'FOO', value: 'bar' }]);
    });

    it('should skip empty lines', () => {
      const result = parseEnvFile('FOO=bar\n\n\nBAZ=qux');
      expect(result).toEqual([
        { key: 'FOO', value: 'bar' },
        { key: 'BAZ', value: 'qux' },
      ]);
    });

    it('should handle double-quoted values', () => {
      const result = parseEnvFile('FOO="hello world"');
      expect(result).toEqual([{ key: 'FOO', value: 'hello world' }]);
    });

    it('should handle single-quoted values', () => {
      const result = parseEnvFile("FOO='hello world'");
      expect(result).toEqual([{ key: 'FOO', value: 'hello world' }]);
    });

    it('should handle export prefix', () => {
      const result = parseEnvFile('export FOO=bar\nexport BAZ=qux');
      expect(result).toEqual([
        { key: 'FOO', value: 'bar' },
        { key: 'BAZ', value: 'qux' },
      ]);
    });

    it('should handle Windows line endings', () => {
      const result = parseEnvFile('FOO=bar\r\nBAZ=qux\r\n');
      expect(result).toEqual([
        { key: 'FOO', value: 'bar' },
        { key: 'BAZ', value: 'qux' },
      ]);
    });

    it('should handle KEY= with no value (empty string)', () => {
      const result = parseEnvFile('FOO=');
      expect(result).toEqual([{ key: 'FOO', value: '' }]);
    });

    it('should skip lines with no equals sign', () => {
      const result = parseEnvFile('NOEQUALSSIGN\nFOO=bar');
      expect(result).toEqual([{ key: 'FOO', value: 'bar' }]);
    });

    it('should skip lines with = but no key', () => {
      const result = parseEnvFile('=value\nFOO=bar');
      expect(result).toEqual([{ key: 'FOO', value: 'bar' }]);
    });

    it('should handle duplicate keys (last value wins)', () => {
      const result = parseEnvFile('FOO=first\nFOO=second');
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ key: 'FOO', value: 'second' });
    });

    it('should handle values containing = sign', () => {
      const result = parseEnvFile('CONNECTION=postgres://user:pass@host/db?opt=1');
      expect(result).toEqual([
        { key: 'CONNECTION', value: 'postgres://user:pass@host/db?opt=1' },
      ]);
    });

    it('should handle empty input', () => {
      expect(parseEnvFile('')).toEqual([]);
    });

    it('should handle input with only comments and blank lines', () => {
      expect(parseEnvFile('# comment\n\n# another')).toEqual([]);
    });
  });

  // ─── validateKeyArg ─────────────────────────────────────────────────
  describe('validateKeyArg()', () => {
    it('should accept plain key names', () => {
      expect(validateKeyArg('STRIPE_KEY')).toBe('STRIPE_KEY');
      expect(validateKeyArg('DATABASE_URL')).toBe('DATABASE_URL');
    });

    it('should reject KEY=value (secret in CLI arg)', () => {
      expect(() => validateKeyArg('STRIPE_KEY=sk_live_123')).toThrow(
        'Cannot pass secret values as CLI arguments',
      );
    });

    it('should accept KEY= (empty value after equals)', () => {
      expect(validateKeyArg('KEY=')).toBe('KEY=');
    });

    it('should mention shell history in error message', () => {
      expect(() => validateKeyArg('KEY=value')).toThrow('shell history');
    });

    it('should suggest secure alternatives in error message', () => {
      expect(() => validateKeyArg('KEY=value')).toThrow('--stdin');
    });
  });

  // ─── importEnvVars + addEnvVar + listEnvVars (with real encryption) ──
  describe('importEnvVars / addEnvVar / listEnvVars', () => {
    let testDir: string;
    let publicKey: string;
    let privateKey: string;

    beforeEach(async () => {
      testDir = path.join(globalThis.TEST_DIR, `env-test-${Date.now()}`);
      fs.mkdirSync(testDir, { recursive: true });

      const keys = await generateKey();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
    });

    it('should import env vars and write encrypted state', async () => {
      const vars = [
        { key: 'STRIPE_KEY', value: 'sk_live_abc123' },
        { key: 'NODE_ENV', value: 'development' },
      ];

      const count = await importEnvVars('my-app', vars, testDir, publicKey, privateKey);

      expect(count).toBe(2);

      // Verify file exists
      const envFile = path.join(testDir, 'env-vars.age');
      expect(fs.existsSync(envFile)).toBe(true);

      // Verify it's encrypted
      const raw = fs.readFileSync(envFile, 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('sk_live_abc123');
      expect(raw).not.toContain('development');
    });

    it('should not create env-vars.json (plaintext)', async () => {
      await importEnvVars(
        'my-app',
        [{ key: 'FOO', value: 'bar' }],
        testDir,
        publicKey,
        privateKey,
      );

      expect(fs.existsSync(path.join(testDir, 'env-vars.json'))).toBe(false);
    });

    it('should merge with existing env vars', async () => {
      await importEnvVars(
        'my-app',
        [{ key: 'KEY1', value: 'val1' }],
        testDir,
        publicKey,
        privateKey,
      );

      await importEnvVars(
        'my-app',
        [{ key: 'KEY2', value: 'val2' }],
        testDir,
        publicKey,
        privateKey,
      );

      const vars = await listEnvVars('my-app', testDir, privateKey, true);
      expect(vars).toHaveLength(2);
      expect(vars.map((v) => v.key)).toContain('KEY1');
      expect(vars.map((v) => v.key)).toContain('KEY2');
    });

    it('should support multiple projects in the same file', async () => {
      await importEnvVars(
        'app-a',
        [{ key: 'KEY_A', value: 'valA' }],
        testDir,
        publicKey,
        privateKey,
      );

      await importEnvVars(
        'app-b',
        [{ key: 'KEY_B', value: 'valB' }],
        testDir,
        publicKey,
        privateKey,
      );

      const varsA = await listEnvVars('app-a', testDir, privateKey, true);
      const varsB = await listEnvVars('app-b', testDir, privateKey, true);

      expect(varsA).toHaveLength(1);
      expect(varsA[0]?.key).toBe('KEY_A');
      expect(varsB).toHaveLength(1);
      expect(varsB[0]?.key).toBe('KEY_B');
    });

    it('addEnvVar should add a single variable', async () => {
      await addEnvVar('my-app', 'SECRET', 'my-secret', testDir, publicKey, privateKey);

      const vars = await listEnvVars('my-app', testDir, privateKey, true);
      expect(vars).toHaveLength(1);
      expect(vars[0]?.key).toBe('SECRET');
      expect(vars[0]?.value).toBe('my-secret');
    });

    it('listEnvVars should hide values by default', async () => {
      await importEnvVars(
        'my-app',
        [{ key: 'SECRET', value: 'hidden-value' }],
        testDir,
        publicKey,
        privateKey,
      );

      const vars = await listEnvVars('my-app', testDir, privateKey, false);
      expect(vars[0]?.value).toBe('********');
    });

    it('listEnvVars with showValues=true should reveal values', async () => {
      await importEnvVars(
        'my-app',
        [{ key: 'SECRET', value: 'revealed-value' }],
        testDir,
        publicKey,
        privateKey,
      );

      const vars = await listEnvVars('my-app', testDir, privateKey, true);
      expect(vars[0]?.value).toBe('revealed-value');
    });

    it('listEnvVars should return empty for nonexistent project', async () => {
      const vars = await listEnvVars('nonexistent', testDir, privateKey, true);
      expect(vars).toEqual([]);
    });

    it('listEnvVars should return empty when no env-vars.age exists', async () => {
      const emptyDir = path.join(globalThis.TEST_DIR, `empty-${Date.now()}`);
      fs.mkdirSync(emptyDir, { recursive: true });

      const vars = await listEnvVars('my-app', emptyDir, privateKey, true);
      expect(vars).toEqual([]);
    });

    it('should include addedAt timestamp in imported vars', async () => {
      await importEnvVars(
        'my-app',
        [{ key: 'KEY', value: 'val' }],
        testDir,
        publicKey,
        privateKey,
      );

      const vars = await listEnvVars('my-app', testDir, privateKey, true);
      expect(vars[0]?.addedAt).toBeDefined();
      // Should be a valid ISO date
      expect(new Date(vars[0]!.addedAt).toISOString()).toBe(vars[0]!.addedAt);
    });
  });
});
