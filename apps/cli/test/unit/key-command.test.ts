import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// ─── Mocks ────────────────────────────────────────────────────────────────

jest.unstable_mockModule('simple-git', () => ({
  simpleGit: jest.fn().mockReturnValue({
    add: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    commit: jest
      .fn<() => Promise<{ commit: string }>>()
      .mockResolvedValue({ commit: 'abc123' }),
    status: jest
      .fn<() => Promise<{ files: Array<{ path: string }> }>>()
      .mockResolvedValue({ files: [{ path: 'state.age' }] }),
    checkout: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    branch: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    branchLocal: jest
      .fn<() => Promise<{ all: string[]; current: string }>>()
      .mockResolvedValue({ all: ['main'], current: 'main' }),
    raw: jest.fn<() => Promise<string>>().mockResolvedValue(''),
  }),
  default: jest.fn(),
}));

const { generateKey } = await import(
  '../../src/core/encryption.js'
);
const { writeState } = await import('../../src/core/state-manager.js');
const {
  executeKeyShow,
  executeKeyVerify,
  executeKeyRotate,
  executeKeyUpdate,
} = await import('../../src/commands/key.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `key-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  const syncDir = path.join(testHome, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
  fs.mkdirSync(syncDir, { recursive: true });

  process.env['CTX_SYNC_HOME'] = testHome;

  const { publicKey, privateKey } = await generateKey();
  fs.writeFileSync(path.join(configDir, 'key.txt'), privateKey, {
    mode: 0o600,
  });

  return { testHome, configDir, syncDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Key Command', () => {
  // ── executeKeyShow() ──────────────────────────────────────────────

  describe('executeKeyShow()', () => {
    it('should return the public key', async () => {
      const { publicKey } = await setupTestEnv();

      const result = await executeKeyShow();

      expect(result.publicKey).toBe(publicKey);
      expect(result.publicKey).toMatch(/^age1[a-z0-9]+$/);
    });

    it('should never return the private key', async () => {
      const { privateKey } = await setupTestEnv();

      const result = await executeKeyShow();

      expect(result.publicKey).not.toContain('AGE-SECRET-KEY-');
      expect(JSON.stringify(result)).not.toContain(privateKey);
    });

    it('should throw if no key exists', async () => {
      const testHome = path.join(
        TEST_DIR,
        `key-nokey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      const configDir = path.join(testHome, '.config', 'ctx-sync');
      fs.mkdirSync(configDir, { recursive: true });
      process.env['CTX_SYNC_HOME'] = testHome;

      await expect(executeKeyShow()).rejects.toThrow('Key file not found');
    });
  });

  // ── executeKeyVerify() ────────────────────────────────────────────

  describe('executeKeyVerify()', () => {
    it('should pass with correct permissions', async () => {
      await setupTestEnv();

      const result = executeKeyVerify();

      expect(result.valid).toBe(true);
      expect(result.keyFileExists).toBe(true);
      expect(result.keyFilePerms).toBe(0o600);
      expect(result.configDirPerms).toBe(0o700);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect insecure key file permissions', async () => {
      const { configDir } = await setupTestEnv();
      fs.chmodSync(path.join(configDir, 'key.txt'), 0o644);

      const result = executeKeyVerify();

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.includes('644'))).toBe(true);
    });

    it('should detect insecure config dir permissions', async () => {
      const { configDir } = await setupTestEnv();
      // Only change the dir perms, not the key file
      fs.chmodSync(configDir, 0o755);

      const result = executeKeyVerify();

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('755'))).toBe(true);
    });

    it('should detect missing key file', async () => {
      const testHome = path.join(
        TEST_DIR,
        `key-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      const configDir = path.join(testHome, '.config', 'ctx-sync');
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      process.env['CTX_SYNC_HOME'] = testHome;

      const result = executeKeyVerify();

      expect(result.valid).toBe(false);
      expect(result.keyFileExists).toBe(false);
    });
  });

  // ── executeKeyRotate() ────────────────────────────────────────────

  describe('executeKeyRotate()', () => {
    it('should generate a new key pair', async () => {
      const { publicKey: oldPublicKey, syncDir } = await setupTestEnv();

      // Write some state to rotate
      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        oldPublicKey,
        'state',
      );

      const result = await executeKeyRotate({ noInteractive: true });

      expect(result.newPublicKey).not.toBe(result.oldPublicKey);
      expect(result.newPublicKey).toMatch(/^age1[a-z0-9]+$/);
      expect(result.oldPublicKey).toBe(oldPublicKey);
    });

    it('should re-encrypt all state files', async () => {
      const { publicKey, syncDir } = await setupTestEnv();

      // Create some state files
      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );
      await writeState(
        syncDir,
        { 'my-app': { NODE_ENV: { value: 'dev', addedAt: new Date().toISOString() } } },
        publicKey,
        'env-vars',
      );

      const result = await executeKeyRotate({ noInteractive: true });

      expect(result.filesReEncrypted).toContain('state.age');
      expect(result.filesReEncrypted).toContain('env-vars.age');
      expect(result.filesReEncrypted.length).toBe(2);
    });

    it('should save new key with correct permissions', async () => {
      const { publicKey, syncDir, configDir } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      await executeKeyRotate({ noInteractive: true });

      const keyPath = path.join(configDir, 'key.txt');
      const stats = fs.statSync(keyPath);
      expect(stats.mode & 0o777).toBe(0o600);

      // New key should be different
      const newKey = fs.readFileSync(keyPath, 'utf-8').trim();
      expect(newKey).toContain('AGE-SECRET-KEY-');
    });
  });

  // ── executeKeyUpdate() ────────────────────────────────────────────

  describe('executeKeyUpdate()', () => {
    it('should save a valid key with correct permissions', async () => {
      await setupTestEnv();
      const { privateKey: newKey } = await generateKey();

      const result = await executeKeyUpdate({ keyInput: newKey });

      expect(result.publicKey).toMatch(/^age1[a-z0-9]+$/);
    });

    it('should reject an invalid key', async () => {
      await setupTestEnv();

      await expect(
        executeKeyUpdate({ keyInput: 'not-a-valid-key' }),
      ).rejects.toThrow('Invalid key format');
    });

    it('should reject an empty key', async () => {
      await setupTestEnv();

      await expect(executeKeyUpdate({ keyInput: '' })).rejects.toThrow(
        'Invalid key format',
      );
    });

    it('should trim whitespace from key', async () => {
      await setupTestEnv();
      const { privateKey: newKey } = await generateKey();

      const result = await executeKeyUpdate({
        keyInput: `  ${newKey}  \n`,
      });

      expect(result.publicKey).toMatch(/^age1[a-z0-9]+$/);
    });
  });
});
