import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Ensure globalThis.TEST_DIR is typed (same as setup.ts / globals.d.ts).
// Needed because @jest/globals import changes ts-jest's compilation context.
declare global {
  var TEST_DIR: string;
}

// --- Types for mock returns ---
interface MockStatusResult {
  files: { path: string }[];
  staged: string[];
  created: string[];
  deleted: string[];
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
const mockAdd = jest.fn<(files: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockCommit = jest.fn<(message: string) => Promise<{ commit: string }>>().mockResolvedValue({ commit: 'abc123' });
const mockPush = jest.fn<(remote: string, branch: string, options: string[]) => Promise<void>>().mockResolvedValue(undefined);
const mockPull = jest.fn<(remote: string, branch: string) => Promise<void>>().mockResolvedValue(undefined);
const mockStatus = jest.fn<() => Promise<MockStatusResult>>().mockResolvedValue({
  files: [],
  staged: [],
  created: [],
  deleted: [],
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

// Make .env() chainable — returns the same instance
mockEnv.mockReturnValue(mockGitInstance);

const mockSimpleGit = jest.fn().mockReturnValue(mockGitInstance);

// Register mock before any import of the module under test
jest.unstable_mockModule('simple-git', () => ({
  simpleGit: mockSimpleGit,
  default: mockSimpleGit,
}));

// Module-under-test functions, assigned in beforeAll after dynamic import
let createGit: (dir: string) => unknown;
let initRepo: (dir: string) => Promise<boolean>;
let addRemote: (dir: string, url: string, remoteName?: string) => Promise<void>;
let commitState: (dir: string, files: string[], message: string) => Promise<string | null>;
let pushState: (dir: string, remoteName?: string, branch?: string) => Promise<void>;
let pullState: (dir: string, remoteName?: string, branch?: string) => Promise<void>;
let getStatus: (dir: string) => Promise<{ files: string[]; ahead: number; behind: number; isClean: boolean }>;

beforeAll(async () => {
  const mod = await import('../../src/core/git-sync.js');
  createGit = mod.createGit;
  initRepo = mod.initRepo;
  addRemote = mod.addRemote;
  commitState = mod.commitState;
  pushState = mod.pushState;
  pullState = mod.pullState;
  getStatus = mod.getStatus;
});

describe('Git Sync Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-enable chainable .env()
    mockEnv.mockReturnValue(mockGitInstance);
  });

  describe('createGit()', () => {
    it('should set GIT_TERMINAL_PROMPT=0 to suppress credential prompts', () => {
      createGit('/some/dir');

      expect(mockSimpleGit).toHaveBeenCalledWith('/some/dir');
      expect(mockEnv).toHaveBeenCalledWith(
        expect.objectContaining({ GIT_TERMINAL_PROMPT: '0' }),
      );
    });

    it('should return a chainable git instance', () => {
      const git = createGit('/some/dir');

      // The returned value should be the mock git instance (from .env() return)
      expect(git).toBe(mockGitInstance);
    });
  });

  describe('initRepo()', () => {
    it('should call git.init() on a new directory', async () => {
      const dir = path.join(globalThis.TEST_DIR, 'new-repo');
      expect(fs.existsSync(path.join(dir, '.git'))).toBe(false);

      const result = await initRepo(dir);

      expect(mockInit).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should skip init on existing .git/ directory', async () => {
      const dir = path.join(globalThis.TEST_DIR, 'existing-repo');
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });

      const result = await initRepo(dir);

      expect(mockInit).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('should create the target directory if it does not exist', async () => {
      const dir = path.join(globalThis.TEST_DIR, 'deep', 'nested', 'repo');
      expect(fs.existsSync(dir)).toBe(false);

      await initRepo(dir);

      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  describe('addRemote()', () => {
    it('should add a new remote with a secure URL', async () => {
      mockGetRemotes.mockResolvedValueOnce([]);

      await addRemote(globalThis.TEST_DIR, 'git@github.com:user/repo.git');

      expect(mockAddRemote).toHaveBeenCalledWith('origin', 'git@github.com:user/repo.git');
    });

    it('should update an existing remote instead of adding', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'git@old.com:u/r.git', push: 'git@old.com:u/r.git' } },
      ]);

      await addRemote(globalThis.TEST_DIR, 'git@github.com:user/repo.git');

      expect(mockRemote).toHaveBeenCalledWith([
        'set-url',
        'origin',
        'git@github.com:user/repo.git',
      ]);
      expect(mockAddRemote).not.toHaveBeenCalled();
    });

    it('should accept a custom remote name', async () => {
      mockGetRemotes.mockResolvedValueOnce([]);

      await addRemote(globalThis.TEST_DIR, 'https://github.com/user/repo.git', 'upstream');

      expect(mockAddRemote).toHaveBeenCalledWith(
        'upstream',
        'https://github.com/user/repo.git',
      );
    });

    it('should throw on insecure URL', async () => {
      await expect(
        addRemote(globalThis.TEST_DIR, 'http://github.com/user/repo.git'),
      ).rejects.toThrow('Insecure Git remote');
    });

    it('should throw on empty URL', async () => {
      await expect(addRemote(globalThis.TEST_DIR, '')).rejects.toThrow(
        'Git remote URL is required',
      );
    });
  });

  describe('commitState()', () => {
    it('should stage files and commit when there are changes', async () => {
      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }],
        staged: ['state.age'],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await commitState(globalThis.TEST_DIR, ['state.age'], 'Update state');

      expect(mockAdd).toHaveBeenCalledWith(['state.age']);
      expect(mockCommit).toHaveBeenCalledWith('Update state');
      expect(result).toBe('abc123');
    });

    it('should skip commit if no changes after staging', async () => {
      mockStatus.mockResolvedValueOnce({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => true,
      });

      const result = await commitState(globalThis.TEST_DIR, ['state.age'], 'Update');

      expect(mockAdd).toHaveBeenCalledWith(['state.age']);
      expect(mockCommit).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('should stage multiple files', async () => {
      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }, { path: 'env-vars.age' }],
        staged: ['state.age', 'env-vars.age'],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      await commitState(
        globalThis.TEST_DIR,
        ['state.age', 'env-vars.age', 'manifest.json'],
        'Full sync',
      );

      expect(mockAdd).toHaveBeenCalledWith([
        'state.age',
        'env-vars.age',
        'manifest.json',
      ]);
      expect(mockCommit).toHaveBeenCalledWith('Full sync');
    });
  });

  describe('pushState()', () => {
    it('should push when remote exists with secure URL', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {
            fetch: 'git@github.com:user/repo.git',
            push: 'git@github.com:user/repo.git',
          },
        },
      ]);

      await pushState(globalThis.TEST_DIR);

      expect(mockPush).toHaveBeenCalledWith('origin', 'main', ['--set-upstream']);
    });

    it('should skip push when no remote is configured', async () => {
      mockGetRemotes.mockResolvedValueOnce([]);

      await pushState(globalThis.TEST_DIR);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should validate remote URL before pushing', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {
            fetch: 'http://insecure.com/repo.git',
            push: 'http://insecure.com/repo.git',
          },
        },
      ]);

      await expect(pushState(globalThis.TEST_DIR)).rejects.toThrow('Insecure Git remote');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should support custom remote name and branch', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'upstream',
          refs: {
            fetch: 'https://github.com/org/repo.git',
            push: 'https://github.com/org/repo.git',
          },
        },
      ]);

      await pushState(globalThis.TEST_DIR, 'upstream', 'develop');

      expect(mockPush).toHaveBeenCalledWith('upstream', 'develop', ['--set-upstream']);
    });
  });

  describe('pullState()', () => {
    it('should pull when remote exists with secure URL', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {
            fetch: 'git@github.com:user/repo.git',
            push: 'git@github.com:user/repo.git',
          },
        },
      ]);

      await pullState(globalThis.TEST_DIR);

      expect(mockPull).toHaveBeenCalledWith('origin', 'main');
    });

    it('should skip pull when no remote is configured', async () => {
      mockGetRemotes.mockResolvedValueOnce([]);

      await pullState(globalThis.TEST_DIR);

      expect(mockPull).not.toHaveBeenCalled();
    });

    it('should validate remote URL before pulling', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'origin',
          refs: {
            fetch: 'http://insecure.com/repo.git',
            push: 'http://insecure.com/repo.git',
          },
        },
      ]);

      await expect(pullState(globalThis.TEST_DIR)).rejects.toThrow('Insecure Git remote');
      expect(mockPull).not.toHaveBeenCalled();
    });

    it('should support custom remote name and branch', async () => {
      mockGetRemotes.mockResolvedValueOnce([
        {
          name: 'upstream',
          refs: {
            fetch: 'https://github.com/org/repo.git',
            push: 'https://github.com/org/repo.git',
          },
        },
      ]);

      await pullState(globalThis.TEST_DIR, 'upstream', 'develop');

      expect(mockPull).toHaveBeenCalledWith('upstream', 'develop');
    });
  });

  describe('getStatus()', () => {
    it('should return clean status when no changes', async () => {
      mockStatus.mockResolvedValueOnce({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => true,
      });

      const status = await getStatus(globalThis.TEST_DIR);

      expect(status.files).toEqual([]);
      expect(status.ahead).toBe(0);
      expect(status.behind).toBe(0);
      expect(status.isClean).toBe(true);
    });

    it('should report changed files', async () => {
      mockStatus.mockResolvedValueOnce({
        files: [{ path: 'state.age' }, { path: 'env-vars.age' }],
        staged: ['state.age'],
        created: [],
        deleted: [],
        ahead: 1,
        behind: 0,
        isClean: () => false,
      });

      const status = await getStatus(globalThis.TEST_DIR);

      expect(status.files).toEqual(['state.age', 'env-vars.age']);
      expect(status.ahead).toBe(1);
      expect(status.behind).toBe(0);
      expect(status.isClean).toBe(false);
    });

    it('should report ahead and behind counts', async () => {
      mockStatus.mockResolvedValueOnce({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        ahead: 3,
        behind: 2,
        isClean: () => true,
      });

      const status = await getStatus(globalThis.TEST_DIR);

      expect(status.ahead).toBe(3);
      expect(status.behind).toBe(2);
    });
  });
});
