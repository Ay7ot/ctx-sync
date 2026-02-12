import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// --- Mock simple-git (for sync repo AND project detection) ---
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
  .mockResolvedValue([
    { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
  ]);
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
    staged: ['state.age', 'manifest.json'],
    created: [],
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

// --- Mock path-validator (test dirs are in /var/folders on macOS) ---
const mockValidateProjectPath = jest
  .fn<(p: string) => string>()
  .mockImplementation((p: string) => p);

jest.unstable_mockModule('../../src/core/path-validator.js', () => ({
  validateProjectPath: mockValidateProjectPath,
  canonicalize: jest.fn((p: string) => p),
}));

// --- Import modules under test (after mocks) ---
const { executeTrack, detectGitInfo } = await import('../../src/commands/track.js');
const { executeInit, getSyncDir } = await import('../../src/commands/init.js');

describe('Track Command', () => {
  let testHome: string;
  let projectDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    testHome = path.join(globalThis.TEST_DIR, `track-test-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });

    // Create a fake project directory inside "home"
    projectDir = path.join(testHome, 'projects', 'my-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

    originalEnv = process.env['CTX_SYNC_HOME'];
    process.env['CTX_SYNC_HOME'] = testHome;

    jest.clearAllMocks();

    // Default: validateProjectPath returns the path as-is
    mockValidateProjectPath.mockImplementation((p: string) => p);

    // Default mock: staged changes exist so commits succeed
    mockStatus.mockResolvedValue({
      files: [],
      staged: ['state.age', 'manifest.json'],
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
    mockStashList.mockResolvedValue({ total: 0, all: [] });

    // Init to create key and sync dir
    await executeInit({ noInteractive: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTX_SYNC_HOME'];
    } else {
      process.env['CTX_SYNC_HOME'] = originalEnv;
    }
  });

  describe('detectGitInfo()', () => {
    it('should detect the current branch', async () => {
      mockBranch.mockResolvedValue({ current: 'feat/awesome' });

      const info = await detectGitInfo(projectDir);
      expect(info.branch).toBe('feat/awesome');
    });

    it('should detect remote URL', async () => {
      const info = await detectGitInfo(projectDir);
      expect(info.remote).toBe('git@github.com:user/repo.git');
    });

    it('should detect uncommitted changes', async () => {
      mockStatus.mockResolvedValue({
        files: [{ path: 'index.ts' }],
        staged: [],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const info = await detectGitInfo(projectDir);
      expect(info.hasUncommitted).toBe(true);
    });

    it('should detect clean working tree', async () => {
      mockStatus.mockResolvedValue({
        files: [],
        staged: [],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => true,
      });

      const info = await detectGitInfo(projectDir);
      expect(info.hasUncommitted).toBe(false);
    });

    it('should detect stash count', async () => {
      mockStashList.mockResolvedValue({ total: 3, all: [{}, {}, {}] });

      const info = await detectGitInfo(projectDir);
      expect(info.stashCount).toBe(3);
    });

    it('should return defaults when directory is not a git repo', async () => {
      const nonGitDir = path.join(testHome, 'projects', 'no-git');
      fs.mkdirSync(nonGitDir, { recursive: true });

      const info = await detectGitInfo(nonGitDir);
      expect(info.branch).toBe('unknown');
      expect(info.remote).toBe('');
      expect(info.hasUncommitted).toBe(false);
      expect(info.stashCount).toBe(0);
    });

    it('should return defaults when no remote is configured', async () => {
      mockGetRemotes.mockResolvedValue([]);

      const info = await detectGitInfo(projectDir);
      expect(info.remote).toBe('');
    });
  });

  describe('executeTrack()', () => {
    it('should create a new project entry with correct structure', async () => {
      const result = await executeTrack({
        path: projectDir,
        noSync: true,
      });

      expect(result.isNew).toBe(true);
      expect(result.project.name).toBe('my-app');
      expect(result.project.path).toBe(projectDir);
      expect(result.project.id).toBeDefined();
      expect(result.project.lastAccessed).toBeDefined();
      expect(result.project.git).toBeDefined();
      expect(result.project.git.branch).toBe('main');
    });

    it('should use --name override for project name', async () => {
      const result = await executeTrack({
        path: projectDir,
        name: 'custom-name',
        noSync: true,
      });

      expect(result.project.name).toBe('custom-name');
    });

    it('should detect .env file presence', async () => {
      fs.writeFileSync(path.join(projectDir, '.env'), 'SECRET=test');

      const result = await executeTrack({
        path: projectDir,
        noSync: true,
      });

      expect(result.envFileFound).toBe(true);
    });

    it('should report no .env when absent', async () => {
      const result = await executeTrack({
        path: projectDir,
        noSync: true,
      });

      expect(result.envFileFound).toBe(false);
    });

    it('should detect docker-compose.yml presence', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'docker-compose.yml'),
        'version: "3"',
      );

      const result = await executeTrack({
        path: projectDir,
        noSync: true,
      });

      expect(result.dockerComposeFound).toBe(true);
    });

    it('should detect compose.yaml (alternative naming)', async () => {
      fs.writeFileSync(
        path.join(projectDir, 'compose.yaml'),
        'version: "3"',
      );

      const result = await executeTrack({
        path: projectDir,
        noSync: true,
      });

      expect(result.dockerComposeFound).toBe(true);
    });

    it('should write state.age to the sync directory', async () => {
      await executeTrack({
        path: projectDir,
        noSync: true,
      });

      const syncDir = getSyncDir();
      expect(fs.existsSync(path.join(syncDir, 'state.age'))).toBe(true);
    });

    it('should write encrypted content (not plaintext JSON)', async () => {
      await executeTrack({
        path: projectDir,
        noSync: true,
      });

      const syncDir = getSyncDir();
      const content = fs.readFileSync(
        path.join(syncDir, 'state.age'),
        'utf-8',
      );

      // Age-encrypted content starts with the armor header
      expect(content).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      // Should NOT contain plaintext project data
      expect(content).not.toContain('my-app');
      expect(content).not.toContain(projectDir);
    });

    it('should NOT write a state.json file', async () => {
      await executeTrack({
        path: projectDir,
        noSync: true,
      });

      const syncDir = getSyncDir();
      expect(fs.existsSync(path.join(syncDir, 'state.json'))).toBe(false);
    });

    it('should update manifest.json with state.age entry', async () => {
      await executeTrack({
        path: projectDir,
        noSync: true,
      });

      const syncDir = getSyncDir();
      const manifest = JSON.parse(
        fs.readFileSync(path.join(syncDir, 'manifest.json'), 'utf-8'),
      );
      expect(manifest.files['state.age']).toBeDefined();
      expect(manifest.files['state.age'].lastModified).toBeDefined();
    });

    it('should update existing project instead of duplicating', async () => {
      // Track once
      const result1 = await executeTrack({
        path: projectDir,
        noSync: true,
      });
      expect(result1.isNew).toBe(true);

      // Track again with updated branch
      mockBranch.mockResolvedValue({ current: 'feat/update' });

      const result2 = await executeTrack({
        path: projectDir,
        noSync: true,
      });
      expect(result2.isNew).toBe(false);
      expect(result2.project.id).toBe(result1.project.id);
      expect(result2.project.git.branch).toBe('feat/update');
    });

    it('should commit to sync repo when noSync is not set', async () => {
      await executeTrack({
        path: projectDir,
      });

      expect(mockAdd).toHaveBeenCalledWith(['state.age', 'manifest.json']);
      expect(mockCommit).toHaveBeenCalledWith(
        expect.stringContaining('track project my-app'),
      );
    });

    it('should skip commit when --no-sync is set', async () => {
      await executeTrack({
        path: projectDir,
        noSync: true,
      });

      // commitState calls mockAdd + mockCommit for the sync repo
      // Init called them once; with noSync, no extra commit for track
      const commitCallsAfterInit = mockCommit.mock.calls.length;
      expect(commitCallsAfterInit).toBe(1); // only the init commit
    });

    it('should call path validation with the project path', async () => {
      await executeTrack({ path: projectDir, noSync: true });
      expect(mockValidateProjectPath).toHaveBeenCalledWith(projectDir);
    });

    it('should reject when path validation fails', async () => {
      mockValidateProjectPath.mockImplementationOnce(() => {
        throw new Error('Blocked path: /etc/malicious');
      });

      await expect(
        executeTrack({ path: '/etc/malicious' }),
      ).rejects.toThrow('Blocked path');
    });

    it('should include git info in the project entry', async () => {
      mockBranch.mockResolvedValue({ current: 'develop' });
      mockStashList.mockResolvedValue({ total: 2, all: [{}, {}] });
      mockStatus.mockResolvedValue({
        files: [{ path: 'dirty.txt' }],
        staged: ['state.age', 'manifest.json'],
        created: [],
        deleted: [],
        ahead: 0,
        behind: 0,
        isClean: () => false,
      });

      const result = await executeTrack({
        path: projectDir,
        noSync: true,
      });

      expect(result.project.git.branch).toBe('develop');
      expect(result.project.git.stashCount).toBe(2);
      expect(result.project.git.hasUncommitted).toBe(true);
      expect(result.project.git.remote).toBe('git@github.com:user/repo.git');
    });

    it('should handle tracking a project without git gracefully', async () => {
      const noGitDir = path.join(testHome, 'projects', 'no-git-project');
      fs.mkdirSync(noGitDir, { recursive: true });

      const result = await executeTrack({
        path: noGitDir,
        noSync: true,
      });

      expect(result.project.git.branch).toBe('unknown');
      expect(result.project.git.remote).toBe('');
      expect(result.project.git.hasUncommitted).toBe(false);
    });
  });
});
