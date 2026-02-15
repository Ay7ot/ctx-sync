import { VERSION } from '@ctx-sync/shared';
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
const mockInit = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockAdd = jest.fn<(files: string | string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockCommit = jest.fn<(message: string) => Promise<{ commit: string }>>().mockResolvedValue({ commit: 'push123' });
const mockPush = jest.fn<(remote: string, branch: string, options: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockPull = jest.fn<(remote: string, branch: string) => Promise<void>>().mockResolvedValue(undefined);
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
const mockEnv = jest.fn<(...args: unknown[]) => unknown>();

const mockGitInstance = {
  init: mockInit,
  add: mockAdd,
  commit: mockCommit,
  push: mockPush,
  pull: mockPull,
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

let executePush: () => Promise<{
  committed: boolean;
  pushed: boolean;
  commitHash: string | null;
  fileCount: number;
  hasRemote: boolean;
}>;

beforeAll(async () => {
  const mod = await import('../../src/commands/push.js');
  executePush = mod.executePush;
});

describe('Push Command', () => {
  let syncDir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    syncDir = path.join(globalThis.TEST_DIR, '.context-sync');
    fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });
    process.env['CTX_SYNC_HOME'] = globalThis.TEST_DIR;

    // Create minimal files
    fs.writeFileSync(
      path.join(syncDir, 'manifest.json'),
      JSON.stringify({ version: VERSION, lastSync: '2025-01-01T00:00:00Z', files: {} }),
    );
    fs.writeFileSync(path.join(syncDir, 'state.age'), 'encrypted-data');
  });

  it('should throw if sync dir does not exist', async () => {
    process.env['CTX_SYNC_HOME'] = path.join(globalThis.TEST_DIR, 'nonexistent');

    await expect(executePush()).rejects.toThrow('No sync repository found');

    process.env['CTX_SYNC_HOME'] = globalThis.TEST_DIR;
  });

  it('should commit and push when remote exists', async () => {
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

    const result = await executePush();

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(true);
    expect(result.hasRemote).toBe(true);
    expect(result.commitHash).toBe('push123');
  });

  it('should commit locally when no remote exists', async () => {
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

    const result = await executePush();

    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.hasRemote).toBe(false);
  });

  it('should not commit when there are no changes', async () => {
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

    const result = await executePush();

    expect(result.committed).toBe(false);
    expect(result.commitHash).toBeNull();
  });

  it('should validate remote URL before pushing', async () => {
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'http://insecure.com/repo.git', push: 'http://insecure.com/repo.git' } },
    ]);

    await expect(executePush()).rejects.toThrow('Insecure Git remote');
  });

  it('should not pull from remote', async () => {
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
    ]);

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

    await executePush();

    // Pull should NOT have been called
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('should update manifest timestamp on push', async () => {
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
    await executePush();
    const after = new Date().toISOString();

    const manifest = JSON.parse(
      fs.readFileSync(path.join(syncDir, 'manifest.json'), 'utf-8'),
    );
    expect(manifest.lastSync >= before).toBe(true);
    expect(manifest.lastSync <= after).toBe(true);
  });
});
