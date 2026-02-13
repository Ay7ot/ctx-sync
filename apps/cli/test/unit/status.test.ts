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
    isClean: () => true,
  });
const mockBranch = jest
  .fn<() => Promise<{ current: string }>>()
  .mockResolvedValue({ current: 'main' });
const mockStashList = jest
  .fn<() => Promise<{ total: number; all: unknown[] }>>()
  .mockResolvedValue({ total: 0, all: [] });
const mockPush = jest
  .fn<(remote: string, branch: string, options: string[]) => Promise<void>>()
  .mockResolvedValue(undefined);

const mockSimpleGit = jest.fn().mockReturnValue({
  init: mockInit,
  add: mockAdd,
  commit: mockCommit,
  push: mockPush,
  getRemotes: mockGetRemotes,
  addRemote: mockAddRemote,
  remote: mockRemote,
  status: mockStatus,
  branch: mockBranch,
  stashList: mockStashList,
});

jest.unstable_mockModule('simple-git', () => ({
  simpleGit: mockSimpleGit,
  default: mockSimpleGit,
}));

// --- Mock path-validator ---
jest.unstable_mockModule('../../src/core/path-validator.js', () => ({
  validateProjectPath: jest.fn((p: string) => p),
  canonicalize: jest.fn((p: string) => p),
}));

// --- Import modules under test (after mocks) ---
const { executeStatus } = await import('../../src/commands/status.js');
const { executeInit } = await import('../../src/commands/init.js');
const { executeTrack } = await import('../../src/commands/track.js');

describe('Status Command', () => {
  let testHome: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    testHome = path.join(globalThis.TEST_DIR, `status-test-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });

    originalEnv = process.env['CTX_SYNC_HOME'];
    process.env['CTX_SYNC_HOME'] = testHome;

    jest.clearAllMocks();

    mockStatus.mockResolvedValue({
      files: [],
      staged: ['manifest.json'],
      created: ['manifest.json'],
      deleted: [],
      ahead: 0,
      behind: 0,
      isClean: () => true,
    });
    mockBranch.mockResolvedValue({ current: 'main' });
    mockGetRemotes.mockResolvedValue([]);
    mockStashList.mockResolvedValue({ total: 0, all: [] });

    await executeInit({ noInteractive: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTX_SYNC_HOME'];
    } else {
      process.env['CTX_SYNC_HOME'] = originalEnv;
    }
  });

  describe('executeStatus()', () => {
    it('should return lastSync from manifest', async () => {
      const result = await executeStatus();
      expect(result.sync.lastSync).toBeDefined();
      expect(result.sync.lastSync).not.toBeNull();
    });

    it('should report no remote when none configured', async () => {
      mockGetRemotes.mockResolvedValue([]);

      const result = await executeStatus();
      expect(result.sync.hasRemote).toBe(false);
    });

    it('should report remote when configured', async () => {
      mockGetRemotes.mockResolvedValue([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      const result = await executeStatus();
      expect(result.sync.hasRemote).toBe(true);
    });

    it('should report clean state with no pending changes', async () => {
      mockStatus.mockResolvedValue({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => true,
      });

      const result = await executeStatus();
      expect(result.sync.isClean).toBe(true);
      expect(result.sync.pendingChanges).toBe(0);
    });

    it('should report pending changes', async () => {
      mockStatus.mockResolvedValue({
        files: [{ path: 'state.age' }, { path: 'manifest.json' }],
        staged: [],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await executeStatus();
      expect(result.sync.isClean).toBe(false);
      expect(result.sync.pendingChanges).toBe(2);
    });

    it('should return empty projects when none tracked', async () => {
      const result = await executeStatus();
      expect(result.projects).toEqual([]);
    });

    it('should return per-project status after tracking', async () => {
      const projectDir = path.join(testHome, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      // Reset mocks for track commit
      mockStatus.mockResolvedValue({
        files: [],
        staged: ['state.age', 'manifest.json'],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      mockBranch.mockResolvedValue({ current: 'feat/cool' });
      mockStashList.mockResolvedValue({ total: 1, all: [{}] });

      await executeTrack({ path: projectDir, name: 'my-app', noSync: true, noInteractive: true });

      // Reset status for the status command
      mockStatus.mockResolvedValue({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => true,
      });

      const result = await executeStatus();
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0]!.name).toBe('my-app');
      expect(result.projects[0]!.branch).toBe('feat/cool');
      expect(result.projects[0]!.hasUncommitted).toBe(true);
      expect(result.projects[0]!.stashCount).toBe(1);
    });

    it('should handle offline state (no remote) correctly', async () => {
      mockGetRemotes.mockResolvedValue([]);

      const result = await executeStatus();
      expect(result.sync.hasRemote).toBe(false);
      expect(result.sync.ahead).toBe(0);
      expect(result.sync.behind).toBe(0);
    });

    it('should include lastAccessed for each project', async () => {
      const projectDir = path.join(testHome, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      // Allow track commit
      mockStatus.mockResolvedValue({
        files: [],
        staged: ['state.age'],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      await executeTrack({ path: projectDir, name: 'my-app', noSync: true, noInteractive: true });

      const result = await executeStatus();
      expect(result.projects[0]!.lastAccessed).toBeDefined();
      expect(new Date(result.projects[0]!.lastAccessed).getTime()).not.toBeNaN();
    });
  });
});
