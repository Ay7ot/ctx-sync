import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

const mockInit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockAddRemote = jest.fn<(name: string, url: string) => Promise<void>>().mockResolvedValue(undefined);
const mockRemote = jest.fn<(args: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockEnv = jest.fn<(...args: unknown[]) => unknown>();

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

jest.unstable_mockModule('simple-git', () => ({
  simpleGit: mockSimpleGit,
  default: mockSimpleGit,
}));

jest.unstable_mockModule('chalk', () => ({
  default: {
    green: (s: string) => s,
    yellow: (s: string) => s,
    dim: (s: string) => s,
    bold: (s: string) => s,
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

let executePull: (options?: { noInteractive?: boolean }) => Promise<{
  pulled: boolean;
  hadConflicts: boolean;
  conflictFiles: string[];
  stateFileCount: number;
  hasRemote: boolean;
}>;

beforeAll(async () => {
  const mod = await import('../../src/commands/pull.js');
  executePull = mod.executePull;
});

describe('Pull Command', () => {
  let syncDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    syncDir = path.join(globalThis.TEST_DIR, '.context-sync');
    fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });
    process.env['CTX_SYNC_HOME'] = globalThis.TEST_DIR;
  });

  it('should throw if sync dir does not exist', async () => {
    process.env['CTX_SYNC_HOME'] = path.join(globalThis.TEST_DIR, 'nonexistent');

    await expect(executePull()).rejects.toThrow('No sync repository found');

    process.env['CTX_SYNC_HOME'] = globalThis.TEST_DIR;
  });

  it('should throw if no remote is configured', async () => {
    mockGetRemotes.mockResolvedValue([]);

    await expect(executePull()).rejects.toThrow('No remote configured');
  });

  it('should pull successfully when remote exists', async () => {
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
    ]);

    // Create a state file to count
    fs.writeFileSync(path.join(syncDir, 'state.age'), 'encrypted');

    const result = await executePull();

    expect(result.pulled).toBe(true);
    expect(result.hasRemote).toBe(true);
    expect(result.hadConflicts).toBe(false);
    expect(result.stateFileCount).toBe(1);
  });

  it('should handle merge conflicts', async () => {
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
    ]);

    // Pull fails with conflict
    mockPull.mockRejectedValueOnce(new Error('CONFLICT (content): Merge conflict in env-vars.age'));

    mockStatus.mockResolvedValueOnce({
      files: [{ path: 'env-vars.age' }],
      staged: [],
      created: [],
      deleted: [],
      conflicted: ['env-vars.age'],
      ahead: 0,
      behind: 0,
      isClean: () => false,
    });

    fs.writeFileSync(path.join(syncDir, 'env-vars.age'), 'encrypted');

    const result = await executePull({ noInteractive: true });

    expect(result.hadConflicts).toBe(true);
    expect(result.conflictFiles).toEqual(['env-vars.age']);
    expect(mockCheckout).toHaveBeenCalledWith(['--ours', 'env-vars.age']);
  });

  it('should validate remote URL before pulling', async () => {
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'http://insecure.com/repo.git', push: 'http://insecure.com/repo.git' } },
    ]);

    await expect(executePull()).rejects.toThrow('Insecure Git remote');
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('should not push after pulling', async () => {
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
    ]);

    await executePull();

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('should report the number of state files after pull', async () => {
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
    ]);

    // Create multiple state files
    fs.writeFileSync(path.join(syncDir, 'state.age'), 'encrypted');
    fs.writeFileSync(path.join(syncDir, 'env-vars.age'), 'encrypted');
    fs.writeFileSync(path.join(syncDir, 'mental-context.age'), 'encrypted');

    const result = await executePull();

    expect(result.stateFileCount).toBe(3);
  });
});
