import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// --- Mock simple-git ---
const mockInit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockAdd = jest.fn<(files: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockCommit = jest
  .fn<(message: string) => Promise<{ commit: string }>>()
  .mockResolvedValue({ commit: 'abc123' });
const mockPush = jest
  .fn<(remote: string, branch: string, options: string[]) => Promise<void>>()
  .mockResolvedValue(undefined);
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
    staged: ['manifest.json'],
    created: ['manifest.json'],
    deleted: [],
    ahead: 0,
    behind: 0,
    isClean: () => false,
  });

const mockSimpleGit = jest.fn().mockReturnValue({
  init: mockInit,
  add: mockAdd,
  commit: mockCommit,
  push: mockPush,
  getRemotes: mockGetRemotes,
  addRemote: mockAddRemote,
  remote: mockRemote,
  status: mockStatus,
});

jest.unstable_mockModule('simple-git', () => ({
  simpleGit: mockSimpleGit,
  default: mockSimpleGit,
}));

// --- Import modules under test (after mocks) ---
const { executeInit, executeRestore, createManifest, getConfigDir, getSyncDir } = await import(
  '../../src/commands/init.js'
);
const { loadKey, KEY_FILE_PERMS, CONFIG_DIR_PERMS } = await import(
  '../../src/core/key-store.js'
);

describe('Init Command', () => {
  let testHome: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testHome = path.join(globalThis.TEST_DIR, `init-test-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });
    originalEnv = process.env['CTX_SYNC_HOME'];
    process.env['CTX_SYNC_HOME'] = testHome;
    jest.clearAllMocks();
    // Re-mock status to have staged changes for commits
    mockStatus.mockResolvedValue({
      files: [],
      staged: ['manifest.json'],
      created: ['manifest.json'],
      deleted: [],
      ahead: 0,
      behind: 0,
      isClean: () => false,
    });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTX_SYNC_HOME'];
    } else {
      process.env['CTX_SYNC_HOME'] = originalEnv;
    }
  });

  describe('getConfigDir()', () => {
    it('should use CTX_SYNC_HOME when set', () => {
      process.env['CTX_SYNC_HOME'] = '/tmp/test-home';
      expect(getConfigDir()).toBe('/tmp/test-home/.config/ctx-sync');
    });
  });

  describe('getSyncDir()', () => {
    it('should use CTX_SYNC_HOME when set', () => {
      process.env['CTX_SYNC_HOME'] = '/tmp/test-home';
      expect(getSyncDir()).toBe('/tmp/test-home/.context-sync');
    });
  });

  describe('createManifest()', () => {
    it('should create manifest.json with correct structure', () => {
      const syncDir = path.join(testHome, '.context-sync');
      fs.mkdirSync(syncDir, { recursive: true });

      const manifest = createManifest(syncDir);

      expect(manifest.version).toBe('1.0.0');
      expect(manifest.lastSync).toBeDefined();
      expect(manifest.files).toEqual({});

      // Verify file on disk
      const onDisk = JSON.parse(
        fs.readFileSync(path.join(syncDir, 'manifest.json'), 'utf-8'),
      );
      expect(onDisk.version).toBe('1.0.0');
    });

    it('should contain only version, lastSync, and files (no sensitive data)', () => {
      const syncDir = path.join(testHome, '.context-sync');
      fs.mkdirSync(syncDir, { recursive: true });

      createManifest(syncDir);

      const content = fs.readFileSync(path.join(syncDir, 'manifest.json'), 'utf-8');
      const parsed = JSON.parse(content);
      const keys = Object.keys(parsed);
      expect(keys).toEqual(['version', 'lastSync', 'files']);
    });
  });

  describe('executeInit()', () => {
    it('should generate a key pair and save the private key', async () => {
      const result = await executeInit({ noInteractive: true });

      expect(result.publicKey).toMatch(/^age1[a-z0-9]+$/);
      expect(result.configDir).toContain('.config/ctx-sync');
      expect(result.manifestCreated).toBe(true);
    });

    it('should save key with correct permissions (0o600)', async () => {
      await executeInit({ noInteractive: true });

      const keyPath = path.join(testHome, '.config', 'ctx-sync', 'key.txt');
      expect(fs.existsSync(keyPath)).toBe(true);

      const stats = fs.statSync(keyPath);
      expect(stats.mode & 0o777).toBe(KEY_FILE_PERMS);
    });

    it('should create config directory with 0o700 permissions', async () => {
      await executeInit({ noInteractive: true });

      const configDir = path.join(testHome, '.config', 'ctx-sync');
      const stats = fs.statSync(configDir);
      expect(stats.mode & 0o777).toBe(CONFIG_DIR_PERMS);
    });

    it('should call initRepo for the sync directory', async () => {
      await executeInit({ noInteractive: true });
      // Since we mock simple-git, initRepo will try to call git.init()
      // but the directory won't have .git, so initRepo should call mockInit
      expect(mockInit).toHaveBeenCalled();
    });

    it('should create manifest.json in the sync directory', async () => {
      await executeInit({ noInteractive: true });

      const manifestPath = path.join(testHome, '.context-sync', 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
    });

    it('should commit the manifest', async () => {
      await executeInit({ noInteractive: true });

      expect(mockAdd).toHaveBeenCalledWith(['manifest.json']);
      expect(mockCommit).toHaveBeenCalledWith('chore: initialize context sync');
    });

    it('should validate and set remote when --remote is provided', async () => {
      const result = await executeInit({
        noInteractive: true,
        remote: 'git@github.com:user/repo.git',
      });

      expect(result.remoteUrl).toBe('git@github.com:user/repo.git');
      expect(mockAddRemote).toHaveBeenCalledWith('origin', 'git@github.com:user/repo.git');
    });

    it('should reject insecure remote URL', async () => {
      await expect(
        executeInit({
          noInteractive: true,
          remote: 'http://github.com/user/repo.git',
        }),
      ).rejects.toThrow('Insecure Git remote');
    });

    it('should work without a remote URL', async () => {
      const result = await executeInit({ noInteractive: true });

      expect(result.remoteUrl).toBeUndefined();
      expect(mockAddRemote).not.toHaveBeenCalled();
    });

    it('should push to remote after commit when remote is provided', async () => {
      // After addRemote, getRemotes should return the configured remote
      mockGetRemotes.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {
            fetch: 'git@github.com:user/repo.git',
            push: 'git@github.com:user/repo.git',
          },
        },
      ]);

      await executeInit({
        noInteractive: true,
        remote: 'git@github.com:user/repo.git',
      });

      expect(mockPush).toHaveBeenCalledWith('origin', 'main', ['--set-upstream']);
    });

    it('should not push when no remote is provided', async () => {
      await executeInit({ noInteractive: true });

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should return the public key (never the private key)', async () => {
      const result = await executeInit({ noInteractive: true });

      expect(result.publicKey).toMatch(/^age1/);
      // The result object should NOT contain privateKey
      expect(result).not.toHaveProperty('privateKey');
    });
  });

  describe('executeRestore()', () => {
    it('should throw when no key is provided', async () => {
      await expect(
        executeRestore({ noInteractive: true }),
      ).rejects.toThrow('Private key is required');
    });

    it('should throw for invalid key format', async () => {
      await expect(
        executeRestore({ noInteractive: true, key: 'not-a-valid-key' }),
      ).rejects.toThrow('Invalid private key format');
    });

    it('should accept a valid AGE-SECRET-KEY and save it', async () => {
      // Generate a real key for testing
      const { generateKey } = await import('../../src/core/encryption.js');
      const { publicKey: _pub, privateKey } = await generateKey();

      const result = await executeRestore({
        noInteractive: true,
        key: privateKey,
      });

      expect(result.configDir).toContain('.config/ctx-sync');
      expect(result.syncDir).toContain('.context-sync');

      // Verify key was saved
      const savedKey = loadKey(path.join(testHome, '.config', 'ctx-sync'));
      expect(savedKey).toBe(privateKey.trim());
    });

    it('should save key with correct permissions on restore', async () => {
      const { generateKey } = await import('../../src/core/encryption.js');
      const { privateKey } = await generateKey();

      await executeRestore({ noInteractive: true, key: privateKey });

      const keyPath = path.join(testHome, '.config', 'ctx-sync', 'key.txt');
      const stats = fs.statSync(keyPath);
      expect(stats.mode & 0o777).toBe(KEY_FILE_PERMS);
    });

    it('should validate remote URL on restore', async () => {
      const { generateKey } = await import('../../src/core/encryption.js');
      const { privateKey } = await generateKey();

      await expect(
        executeRestore({
          noInteractive: true,
          key: privateKey,
          remote: 'http://insecure.example.com/repo.git',
        }),
      ).rejects.toThrow('Insecure Git remote');
    });

    it('should return zero projects when sync dir is empty', async () => {
      const { generateKey } = await import('../../src/core/encryption.js');
      const { privateKey } = await generateKey();

      const result = await executeRestore({
        noInteractive: true,
        key: privateKey,
      });

      expect(result.projectCount).toBe(0);
      expect(result.projectNames).toEqual([]);
    });

    it('should trim whitespace from provided key', async () => {
      const { generateKey } = await import('../../src/core/encryption.js');
      const { privateKey } = await generateKey();

      const result = await executeRestore({
        noInteractive: true,
        key: `  ${privateKey}  \n`,
      });

      expect(result.configDir).toBeDefined();
    });
  });
});
