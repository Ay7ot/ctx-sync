import { VERSION } from '@ctx-sync/shared';
import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Ensure globalThis.TEST_DIR is typed
declare global {
  var TEST_DIR: string;
}

// --- Types for mock returns ---
interface MockStatusResult {
  files: { path: string }[];
  staged: string[];
  created: string[];
  deleted: string[];
  conflicted: string[];
  ahead: number;
  behind: number;
  isClean: () => boolean;
}

interface MockRemoteEntry {
  name: string;
  refs: { fetch: string; push: string };
}

// --- Mock simple-git ---
const mockInit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockAdd = jest.fn<(files: string | string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockCommit = jest.fn<(message: string) => Promise<{ commit: string }>>().mockResolvedValue({ commit: 'abc123' });
const mockPush = jest.fn<(remote: string, branch: string, options: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockPull = jest.fn<(remote: string, branch: string) => Promise<void>>().mockResolvedValue(undefined);
const mockCheckout = jest.fn<(args: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockStatus = jest.fn<() => Promise<MockStatusResult>>().mockResolvedValue({
  files: [],
  staged: [],
  created: [],
  deleted: [],
  conflicted: [],
  ahead: 0,
  behind: 0,
  isClean: () => true,
});
const mockGetRemotes = jest.fn<() => Promise<MockRemoteEntry[]>>().mockResolvedValue([]);
const mockAddRemote = jest.fn<(name: string, url: string) => Promise<void>>().mockResolvedValue(undefined);
const mockRemote = jest.fn<(args: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockEnv = jest.fn<(key: string, value: string) => unknown>();

const mockGitInstance = {
  init: mockInit,
  add: mockAdd,
  commit: mockCommit,
  push: mockPush,
  pull: mockPull,
  checkout: mockCheckout,
  status: mockStatus,
  getRemotes: mockGetRemotes,
  addRemote: mockAddRemote,
  remote: mockRemote,
  env: mockEnv,
};

mockEnv.mockReturnValue(mockGitInstance);

const mockSimpleGit = jest.fn().mockReturnValue(mockGitInstance);

// Register mock before any import of the module under test
jest.unstable_mockModule('simple-git', () => ({
  simpleGit: mockSimpleGit,
  default: mockSimpleGit,
}));

// Mock chalk and ora for non-interactive testing
jest.unstable_mockModule('chalk', () => ({
  default: {
    green: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
    cyan: (s: string) => s,
    red: (s: string) => s,
  },
}));

jest.unstable_mockModule('ora', () => ({
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    text: '',
  }),
}));

// Module-under-test functions, assigned in beforeAll after dynamic import
let validateSyncRemote: (syncDir: string) => Promise<string | null>;
let pullWithConflictDetection: (syncDir: string) => Promise<{ pulled: boolean; conflictFiles: string[] }>;
let resolveConflicts: (syncDir: string, conflictFiles: string[], useLocal?: boolean) => Promise<void>;
let collectSyncFiles: (syncDir: string) => string[];
let executeSync: (options?: Record<string, boolean>) => Promise<{
  pulled: boolean;
  committed: boolean;
  pushed: boolean;
  commitHash: string | null;
  fileCount: number;
  hadConflicts: boolean;
  conflictFiles: string[];
  hasRemote: boolean;
}>;

beforeAll(async () => {
  const mod = await import('../../src/commands/sync.js');
  validateSyncRemote = mod.validateSyncRemote;
  pullWithConflictDetection = mod.pullWithConflictDetection;
  resolveConflicts = mod.resolveConflicts;
  collectSyncFiles = mod.collectSyncFiles;
  executeSync = mod.executeSync;
});

describe('Sync Command', () => {
  let syncDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    syncDir = path.join(globalThis.TEST_DIR, '.context-sync');
    fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });

    // Set CTX_SYNC_HOME so getSyncDir() resolves to our test dir
    process.env['CTX_SYNC_HOME'] = globalThis.TEST_DIR;
  });

  describe('validateSyncRemote()', () => {
    it('should return null when no remote is configured', async () => {
      mockGetRemotes.mockResolvedValueOnce([]);

      const result = await validateSyncRemote(syncDir);

      expect(result).toBeNull();
    });

    it('should return the URL when remote is configured with secure URL', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      const result = await validateSyncRemote(syncDir);

      expect(result).toBe('git@github.com:user/repo.git');
    });

    it('should throw on insecure remote URL', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'http://insecure.com/repo.git', push: 'http://insecure.com/repo.git' } },
      ]);

      await expect(validateSyncRemote(syncDir)).rejects.toThrow('Insecure Git remote');
    });

    it('should accept HTTPS remote URL', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'https://github.com/user/repo.git', push: 'https://github.com/user/repo.git' } },
      ]);

      const result = await validateSyncRemote(syncDir);

      expect(result).toBe('https://github.com/user/repo.git');
    });
  });

  describe('pullWithConflictDetection()', () => {
    it('should pull successfully when no conflicts', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      const result = await pullWithConflictDetection(syncDir);

      expect(result.pulled).toBe(true);
      expect(result.conflictFiles).toEqual([]);
      expect(mockPull).toHaveBeenCalledWith('origin', 'main');
    });

    it('should skip pull when no remote is configured', async () => {
      mockGetRemotes.mockResolvedValueOnce([]);

      const result = await pullWithConflictDetection(syncDir);

      expect(result.pulled).toBe(false);
      expect(result.conflictFiles).toEqual([]);
      expect(mockPull).not.toHaveBeenCalled();
    });

    it('should detect merge conflicts and return conflicting files', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      // Simulate pull failure due to conflict
      mockPull.mockRejectedValueOnce(new Error('CONFLICT (content): Merge conflict in state.age'));

      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }],
        staged: [],
        created: [],
        deleted: [],
        conflicted: ['state.age', 'env-vars.age'],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await pullWithConflictDetection(syncDir);

      expect(result.pulled).toBe(true);
      expect(result.conflictFiles).toEqual(['state.age', 'env-vars.age']);
    });

    it('should validate remote URL before pulling', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'http://insecure.com/repo.git', push: 'http://insecure.com/repo.git' } },
      ]);

      await expect(pullWithConflictDetection(syncDir)).rejects.toThrow('Insecure Git remote');
      expect(mockPull).not.toHaveBeenCalled();
    });

    it('should re-throw non-conflict errors', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      mockPull.mockRejectedValueOnce(new Error('fatal: remote origin does not exist'));

      await expect(pullWithConflictDetection(syncDir)).rejects.toThrow('fatal: remote origin does not exist');
    });
  });

  describe('resolveConflicts()', () => {
    it('should resolve conflicts using local version (--ours)', async () => {
      await resolveConflicts(syncDir, ['state.age', 'env-vars.age'], true);

      expect(mockCheckout).toHaveBeenCalledWith(['--ours', 'state.age']);
      expect(mockCheckout).toHaveBeenCalledWith(['--ours', 'env-vars.age']);
      expect(mockAdd).toHaveBeenCalledWith('state.age');
      expect(mockAdd).toHaveBeenCalledWith('env-vars.age');
    });

    it('should resolve conflicts using remote version (--theirs)', async () => {
      await resolveConflicts(syncDir, ['state.age'], false);

      expect(mockCheckout).toHaveBeenCalledWith(['--theirs', 'state.age']);
      expect(mockAdd).toHaveBeenCalledWith('state.age');
    });

    it('should default to local version when useLocal not specified', async () => {
      await resolveConflicts(syncDir, ['state.age']);

      expect(mockCheckout).toHaveBeenCalledWith(['--ours', 'state.age']);
    });

    it('should handle empty conflict list gracefully', async () => {
      await resolveConflicts(syncDir, []);

      expect(mockCheckout).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  describe('collectSyncFiles()', () => {
    it('should collect .age files and manifest.json', () => {
      // Create test files
      fs.writeFileSync(path.join(syncDir, 'state.age'), 'encrypted');
      fs.writeFileSync(path.join(syncDir, 'env-vars.age'), 'encrypted');
      fs.writeFileSync(path.join(syncDir, 'manifest.json'), '{}');

      const files = collectSyncFiles(syncDir);

      expect(files).toContain('state.age');
      expect(files).toContain('env-vars.age');
      expect(files).toContain('manifest.json');
    });

    it('should not include non-.age, non-manifest files', () => {
      fs.writeFileSync(path.join(syncDir, 'state.age'), 'encrypted');
      fs.writeFileSync(path.join(syncDir, 'some-other.txt'), 'data');
      fs.writeFileSync(path.join(syncDir, 'manifest.json'), '{}');

      const files = collectSyncFiles(syncDir);

      expect(files).toContain('state.age');
      expect(files).toContain('manifest.json');
      expect(files).not.toContain('some-other.txt');
    });

    it('should return empty array when sync dir has no state files', () => {
      const emptyDir = path.join(globalThis.TEST_DIR, 'empty-sync');
      fs.mkdirSync(emptyDir, { recursive: true });

      const files = collectSyncFiles(emptyDir);

      expect(files).toEqual([]);
    });
  });

  describe('executeSync()', () => {
    beforeEach(() => {
      // Create a minimal sync dir with manifest
      fs.writeFileSync(
        path.join(syncDir, 'manifest.json'),
        JSON.stringify({ version: VERSION, lastSync: '2025-01-01T00:00:00Z', files: {} }),
      );
      fs.writeFileSync(path.join(syncDir, 'state.age'), 'encrypted-state');
    });

    it('should throw if sync dir does not exist', async () => {
      process.env['CTX_SYNC_HOME'] = path.join(globalThis.TEST_DIR, 'nonexistent');

      await expect(executeSync()).rejects.toThrow('No sync repository found');

      // Restore
      process.env['CTX_SYNC_HOME'] = globalThis.TEST_DIR;
    });

    it('should perform full sync: pull → commit → push', async () => {
      // Configure mock remote
      mockGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      // Mock status for commitState to detect changes
      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }],
        staged: ['state.age'],
        created: [],
        deleted: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await executeSync();

      expect(result.pulled).toBe(true);
      expect(result.committed).toBe(true);
      expect(result.pushed).toBe(true);
      expect(result.hasRemote).toBe(true);
      expect(result.commitHash).toBe('abc123');
    });

    it('should handle local-only mode (no remote)', async () => {
      mockGetRemotes.mockResolvedValue([]);

      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }],
        staged: ['state.age'],
        created: [],
        deleted: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await executeSync();

      expect(result.pulled).toBe(false);
      expect(result.pushed).toBe(false);
      expect(result.hasRemote).toBe(false);
      expect(result.committed).toBe(true);
    });

    it('should skip pull when noPull is set', async () => {
      mockGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }],
        staged: ['state.age'],
        created: [],
        deleted: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await executeSync({ noPull: true });

      expect(result.pulled).toBe(false);
      expect(result.pushed).toBe(true);
    });

    it('should skip push when noPush is set', async () => {
      mockGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }],
        staged: ['state.age'],
        created: [],
        deleted: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await executeSync({ noPush: true });

      expect(result.pulled).toBe(true);
      expect(result.pushed).toBe(false);
    });

    it('should not commit when there are no changes', async () => {
      mockGetRemotes.mockResolvedValue([]);

      // No staged changes → commitState returns null
      mockStatus.mockResolvedValueOnce({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        isClean: () => true,
      });

      const result = await executeSync();

      expect(result.committed).toBe(false);
      expect(result.commitHash).toBeNull();
    });

    it('should handle merge conflicts and resolve with local version', async () => {
      mockGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      // Pull fails with conflict
      mockPull.mockRejectedValueOnce(new Error('CONFLICT (content): Merge conflict in state.age'));

      // Status after conflict
      mockStatus
        .mockResolvedValueOnce({
          files: [{ path: 'state.age' }],
          staged: [],
          created: [],
          deleted: [],
          conflicted: ['state.age'],
          ahead: 0,
          behind: 0,
          isClean: () => false,
        })
        // Status for commitState
        .mockResolvedValueOnce({
          files: [{ path: 'state.age' }],
          staged: ['state.age'],
          created: [],
          deleted: [],
          conflicted: [],
          ahead: 0,
          behind: 0,
          isClean: () => false,
        });

      const result = await executeSync({ noInteractive: true });

      expect(result.hadConflicts).toBe(true);
      expect(result.conflictFiles).toEqual(['state.age']);
      // Should have resolved with --ours
      expect(mockCheckout).toHaveBeenCalledWith(['--ours', 'state.age']);
    });

    it('should validate remote URL on every sync', async () => {
      mockGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'http://insecure.com/repo.git', push: 'http://insecure.com/repo.git' } },
      ]);

      await expect(executeSync()).rejects.toThrow('Insecure Git remote');
    });

    it('should update manifest timestamp on sync', async () => {
      mockGetRemotes.mockResolvedValue([]);
      mockStatus.mockResolvedValueOnce({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        conflicted: [],
        ahead: 0,
        behind: 0,
        isClean: () => true,
      });

      const before = new Date().toISOString();
      await executeSync();
      const after = new Date().toISOString();

      const manifest = JSON.parse(
        fs.readFileSync(path.join(syncDir, 'manifest.json'), 'utf-8'),
      );
      expect(manifest.lastSync >= before).toBe(true);
      expect(manifest.lastSync <= after).toBe(true);
    });
  });
});
