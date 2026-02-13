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
    isClean: () => false,
  });
const mockBranch = jest
  .fn<() => Promise<{ current: string }>>()
  .mockResolvedValue({ current: 'main' });
const mockStashList = jest
  .fn<() => Promise<{ total: number; all: unknown[] }>>()
  .mockResolvedValue({ total: 0, all: [] });

const mockSimpleGit = jest.fn().mockReturnValue({
  init: mockInit,
  add: mockAdd,
  commit: mockCommit,
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

// --- Mock path-validator (test dirs are in /var/folders on macOS) ---
jest.unstable_mockModule('../../src/core/path-validator.js', () => ({
  validateProjectPath: jest.fn((p: string) => p),
  canonicalize: jest.fn((p: string) => p),
}));

// --- Import modules under test (after mocks) ---
const { executeList, formatProject } = await import('../../src/commands/list.js');
const { executeInit } = await import('../../src/commands/init.js');
const { executeTrack } = await import('../../src/commands/track.js');

describe('List Command', () => {
  let testHome: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    testHome = path.join(globalThis.TEST_DIR, `list-test-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });

    originalEnv = process.env['CTX_SYNC_HOME'];
    process.env['CTX_SYNC_HOME'] = testHome;

    jest.clearAllMocks();

    mockStatus.mockResolvedValue({
      files: [],
      staged: ['manifest.json', 'state.age'],
      created: [],
      deleted: [],
      ahead: 0,
      behind: 0,
      isClean: () => false,
    });
    mockBranch.mockResolvedValue({ current: 'main' });
    mockGetRemotes.mockResolvedValue([
      { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
    ]);

    await executeInit({ noInteractive: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTX_SYNC_HOME'];
    } else {
      process.env['CTX_SYNC_HOME'] = originalEnv;
    }
  });

  describe('executeList()', () => {
    it('should return empty array when no projects are tracked', async () => {
      const result = await executeList();
      expect(result.projects).toEqual([]);
    });

    it('should return tracked projects after tracking one', async () => {
      const projectDir = path.join(testHome, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      await executeTrack({ path: projectDir, name: 'my-app', noSync: true, noInteractive: true });

      const result = await executeList();
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0]!.name).toBe('my-app');
      expect(result.projects[0]!.path).toBe(projectDir);
    });

    it('should return multiple tracked projects', async () => {
      const project1 = path.join(testHome, 'projects', 'app-one');
      const project2 = path.join(testHome, 'projects', 'app-two');
      fs.mkdirSync(project1, { recursive: true });
      fs.mkdirSync(project2, { recursive: true });
      fs.mkdirSync(path.join(project1, '.git'), { recursive: true });
      fs.mkdirSync(path.join(project2, '.git'), { recursive: true });

      await executeTrack({ path: project1, name: 'app-one', noSync: true, noInteractive: true });

      mockBranch.mockResolvedValue({ current: 'develop' });
      await executeTrack({ path: project2, name: 'app-two', noSync: true, noInteractive: true });

      const result = await executeList();
      expect(result.projects).toHaveLength(2);
      expect(result.projects.map((p) => p.name)).toContain('app-one');
      expect(result.projects.map((p) => p.name)).toContain('app-two');
    });

    it('should include git info for each project', async () => {
      const projectDir = path.join(testHome, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      mockBranch.mockResolvedValue({ current: 'feat/awesome' });
      mockStashList.mockResolvedValue({ total: 2, all: [{}, {}] });
      mockStatus.mockResolvedValue({
        files: [{ path: 'dirty.txt' }],
        staged: ['state.age'],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      await executeTrack({ path: projectDir, name: 'my-app', noSync: true, noInteractive: true });

      const result = await executeList();
      const project = result.projects[0]!;
      expect(project.git.branch).toBe('feat/awesome');
      expect(project.git.hasUncommitted).toBe(true);
      expect(project.git.stashCount).toBe(2);
    });

    it('should include lastAccessed timestamp', async () => {
      const projectDir = path.join(testHome, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      await executeTrack({ path: projectDir, name: 'my-app', noSync: true, noInteractive: true });

      const result = await executeList();
      expect(result.projects[0]!.lastAccessed).toBeDefined();
      // Timestamp should be a valid ISO date
      expect(new Date(result.projects[0]!.lastAccessed).getTime()).not.toBeNaN();
    });
  });

  describe('formatProject()', () => {
    const sampleProject = {
      id: 'abc123',
      name: 'my-app',
      path: '/home/user/projects/my-app',
      git: {
        branch: 'main',
        remote: 'git@github.com:user/repo.git',
        hasUncommitted: false,
        stashCount: 0,
      },
      lastAccessed: new Date().toISOString(),
    };

    it('should format project with name, path, branch, and timestamp', () => {
      const output = formatProject(sampleProject, 1);
      expect(output).toContain('1. my-app');
      expect(output).toContain('/home/user/projects/my-app');
      expect(output).toContain('main');
      expect(output).toContain('Tracked:');
    });

    it('should show uncommitted status when present', () => {
      const dirty = {
        ...sampleProject,
        git: { ...sampleProject.git, hasUncommitted: true },
      };
      const output = formatProject(dirty, 1);
      expect(output).toContain('uncommitted changes');
    });

    it('should show stash count when present', () => {
      const stashed = {
        ...sampleProject,
        git: { ...sampleProject.git, stashCount: 3 },
      };
      const output = formatProject(stashed, 1);
      expect(output).toContain('3');
    });

    it('should not show uncommitted when clean', () => {
      const output = formatProject(sampleProject, 1);
      expect(output).not.toContain('uncommitted');
    });

    it('should not show stash count when zero', () => {
      const output = formatProject(sampleProject, 1);
      expect(output).not.toContain('Stashes');
    });

    it('should use the correct index number', () => {
      const output = formatProject(sampleProject, 5);
      expect(output).toContain('5. my-app');
    });
  });
});
