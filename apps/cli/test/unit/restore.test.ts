import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// --- Mock simple-git ---
const mockBranch = jest.fn<() => Promise<{ current: string }>>().mockResolvedValue({ current: 'main' });
const mockCheckout = jest.fn<(branch: string) => Promise<void>>().mockResolvedValue(undefined);
const mockGetRemotes = jest.fn<() => Promise<Array<{ name: string; refs: { fetch: string; push: string } }>>>().mockResolvedValue([]);
const mockPull = jest.fn<(remote: string, branch: string) => Promise<void>>().mockResolvedValue(undefined);
const mockEnv = jest.fn<(key: string, value: string) => unknown>();

const mockGitInstance = {
  branch: mockBranch,
  checkout: mockCheckout,
  getRemotes: mockGetRemotes,
  pull: mockPull,
  env: mockEnv,
};

mockEnv.mockReturnValue(mockGitInstance);

const mockSimpleGit = jest.fn().mockReturnValue(mockGitInstance);

jest.unstable_mockModule('simple-git', () => ({
  simpleGit: mockSimpleGit,
  default: mockSimpleGit,
}));

// Mock chalk and ora
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

// Import modules under test (after mocks)
const { executeRestore, writeEnvFile, checkoutBranch, formatMentalContext } =
  await import('../../src/commands/restore.js');
const { generateKey } = await import('../../src/core/encryption.js');
const { saveKey } = await import('../../src/core/key-store.js');
const { writeState } = await import('../../src/core/state-manager.js');

// Helper to set up a test environment
async function setupTestEnv(): Promise<{
  homeDir: string;
  configDir: string;
  syncDir: string;
  privateKey: string;
  publicKey: string;
}> {
  const homeDir = path.join(globalThis.TEST_DIR, `restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const configDir = path.join(homeDir, '.config', 'ctx-sync');
  const syncDir = path.join(homeDir, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });

  // Generate and save key
  const { publicKey, privateKey } = await generateKey();
  saveKey(configDir, privateKey);

  // Set env var for path resolution
  process.env['CTX_SYNC_HOME'] = homeDir;

  return { homeDir, configDir, syncDir, privateKey, publicKey };
}

describe('Restore Command', () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env['CTX_SYNC_HOME'];
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env['CTX_SYNC_HOME'] = originalHome;
    } else {
      delete process.env['CTX_SYNC_HOME'];
    }
  });

  describe('executeRestore()', () => {
    it('should throw if no sync repo exists', async () => {
      const homeDir = path.join(globalThis.TEST_DIR, `restore-nosync-${Date.now()}`);
      fs.mkdirSync(homeDir, { recursive: true });
      process.env['CTX_SYNC_HOME'] = homeDir;

      await expect(executeRestore('my-app')).rejects.toThrow('No sync repository found');
    });

    it('should throw if no state file exists', async () => {
      await setupTestEnv();

      await expect(executeRestore('my-app')).rejects.toThrow('No state file found');
    });

    it('should throw if project not found', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      // Write state with a different project
      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'other-id',
              name: 'other-project',
              path: '/path/to/other',
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      await expect(executeRestore('nonexistent')).rejects.toThrow('Project "nonexistent" not found');
    });

    it('should list available projects in error when project not found', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: '/path/to/app',
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      await expect(executeRestore('wrong')).rejects.toThrow('my-app');
    });

    it('should auto-pull from remote before restoring (when remote exists)', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      // Simulate a remote being configured
      mockGetRemotes.mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]).mockResolvedValueOnce([
        { name: 'origin', refs: { fetch: 'git@github.com:user/repo.git', push: 'git@github.com:user/repo.git' } },
      ]);

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: '/path/to/app',
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      const result = await executeRestore('my-app', { noInteractive: true });

      expect(result.pulled).toBe(true);
      expect(mockPull).toHaveBeenCalledWith('origin', 'main');
    });

    it('should skip pull when --no-pull is passed', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: '/path/to/app',
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      const result = await executeRestore('my-app', { noInteractive: true, noPull: true });

      expect(result.pulled).toBe(false);
      expect(mockPull).not.toHaveBeenCalled();
    });

    it('should restore a project with correct info', async () => {
      const { syncDir, publicKey, homeDir } = await setupTestEnv();

      const projectPath = path.join(homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectPath, { recursive: true });

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: projectPath,
              git: { branch: 'feature/test', remote: 'origin', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      const result = await executeRestore('my-app', { noInteractive: true });

      expect(result.project.name).toBe('my-app');
      expect(result.project.git.branch).toBe('feature/test');
    });

    it('should find project by ID', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'unique-id-123',
              name: 'my-app',
              path: '/path/to/app',
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      const result = await executeRestore('unique-id-123', { noInteractive: true });

      expect(result.project.name).toBe('my-app');
    });

    it('should count env vars correctly', async () => {
      const { syncDir, publicKey, homeDir } = await setupTestEnv();

      const projectPath = path.join(homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectPath, { recursive: true });

      // Write state
      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: projectPath,
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      // Write env vars
      await writeState(
        syncDir,
        {
          'my-app': {
            'NODE_ENV': { value: 'development', addedAt: new Date().toISOString() },
            'PORT': { value: '3000', addedAt: new Date().toISOString() },
            'SECRET_KEY': { value: 'sk_test_123', addedAt: new Date().toISOString() },
          },
        },
        publicKey,
        'env-vars',
      );

      const result = await executeRestore('my-app', { noInteractive: true });

      expect(result.envVarCount).toBe(3);
    });

    it('should load mental context when available', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: '/path/to/app',
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      await writeState(
        syncDir,
        {
          'my-app': {
            currentTask: 'Implementing Stripe webhooks',
            blockers: [{ description: 'Waiting for API keys', addedAt: new Date().toISOString(), priority: 'high' as const }],
            nextSteps: ['Test with Stripe CLI', 'Add error handling'],
            relatedLinks: [],
            breadcrumbs: [],
          },
        },
        publicKey,
        'mental-context',
      );

      const result = await executeRestore('my-app', { noInteractive: true });

      expect(result.mentalContext).not.toBeNull();
      expect(result.mentalContext?.currentTask).toBe('Implementing Stripe webhooks');
      expect(result.mentalContext?.blockers).toHaveLength(1);
      expect(result.mentalContext?.nextSteps).toHaveLength(2);
    });

    it('should skip command execution in non-interactive mode', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: '/path/to/app',
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      // Write service state
      await writeState(
        syncDir,
        {
          services: [
            { project: 'my-app', name: 'dev-server', port: 3000, command: 'npm run dev', autoStart: true },
          ],
        },
        publicKey,
        'services',
      );

      const result = await executeRestore('my-app', { noInteractive: true });

      expect(result.approval.skippedAll).toBe(true);
      expect(result.executedCommands).toHaveLength(0);
      expect(result.commandsPresented).toHaveLength(1);
    });

    it('should write .env file when project dir exists', async () => {
      const { syncDir, publicKey, homeDir } = await setupTestEnv();

      const projectPath = path.join(homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectPath, { recursive: true });

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'app-id',
              name: 'my-app',
              path: projectPath,
              git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      await writeState(
        syncDir,
        {
          'my-app': {
            'NODE_ENV': { value: 'development', addedAt: new Date().toISOString() },
            'PORT': { value: '3000', addedAt: new Date().toISOString() },
          },
        },
        publicKey,
        'env-vars',
      );

      const result = await executeRestore('my-app', { noInteractive: true });

      expect(result.envFileWritten).toBe(true);

      // Verify .env file content
      const envContent = fs.readFileSync(path.join(projectPath, '.env'), 'utf-8');
      expect(envContent).toContain('NODE_ENV=development');
      expect(envContent).toContain('PORT=3000');
      expect(envContent).toContain('Generated by ctx-sync restore');
    });
  });

  describe('writeEnvFile()', () => {
    it('should write valid .env file', () => {
      const dir = path.join(globalThis.TEST_DIR, `envfile-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });

      const written = writeEnvFile(dir, {
        'KEY1': { value: 'value1', addedAt: new Date().toISOString() },
        'KEY2': { value: 'value2', addedAt: new Date().toISOString() },
      });

      expect(written).toBe(true);
      const content = fs.readFileSync(path.join(dir, '.env'), 'utf-8');
      expect(content).toContain('KEY1=value1');
      expect(content).toContain('KEY2=value2');
    });

    it('should quote values with spaces', () => {
      const dir = path.join(globalThis.TEST_DIR, `envfile-sp-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });

      writeEnvFile(dir, {
        'MSG': { value: 'hello world', addedAt: new Date().toISOString() },
      });

      const content = fs.readFileSync(path.join(dir, '.env'), 'utf-8');
      expect(content).toContain('MSG="hello world"');
    });

    it('should return false if directory does not exist', () => {
      const result = writeEnvFile('/nonexistent/path', {
        'KEY': { value: 'val', addedAt: new Date().toISOString() },
      });

      expect(result).toBe(false);
    });

    it('should include header comment', () => {
      const dir = path.join(globalThis.TEST_DIR, `envfile-hdr-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });

      writeEnvFile(dir, {
        'KEY': { value: 'val', addedAt: new Date().toISOString() },
      });

      const content = fs.readFileSync(path.join(dir, '.env'), 'utf-8');
      expect(content).toContain('# Generated by ctx-sync restore');
    });
  });

  describe('checkoutBranch()', () => {
    it('should return false if no .git directory', async () => {
      const dir = path.join(globalThis.TEST_DIR, `nogit-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });

      const result = await checkoutBranch(dir, 'main');
      expect(result).toBe(false);
    });

    it('should return false for unknown branch', async () => {
      const dir = path.join(globalThis.TEST_DIR, `unknown-br-${Date.now()}`);
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });

      const result = await checkoutBranch(dir, 'unknown');
      expect(result).toBe(false);
    });

    it('should return false for empty branch name', async () => {
      const dir = path.join(globalThis.TEST_DIR, `empty-br-${Date.now()}`);
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });

      const result = await checkoutBranch(dir, '');
      expect(result).toBe(false);
    });

    it('should return true if already on the right branch', async () => {
      const dir = path.join(globalThis.TEST_DIR, `same-br-${Date.now()}`);
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });

      mockBranch.mockResolvedValueOnce({ current: 'feature/test' });

      const result = await checkoutBranch(dir, 'feature/test');
      expect(result).toBe(true);
    });
  });

  describe('formatMentalContext()', () => {
    it('should format current task', () => {
      const output = formatMentalContext({
        currentTask: 'Implementing Stripe webhooks',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      });

      expect(output).toContain('You were working on');
      expect(output).toContain('Implementing Stripe webhooks');
    });

    it('should format blockers', () => {
      const output = formatMentalContext({
        currentTask: 'Testing',
        blockers: [{ description: 'Waiting for API keys', addedAt: new Date().toISOString(), priority: 'high' }],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      });

      expect(output).toContain('Blockers');
      expect(output).toContain('Waiting for API keys');
    });

    it('should format next steps', () => {
      const output = formatMentalContext({
        currentTask: 'Testing',
        blockers: [],
        nextSteps: ['Test with Stripe CLI', 'Add error handling'],
        relatedLinks: [],
        breadcrumbs: [],
      });

      expect(output).toContain('Next steps');
      expect(output).toContain('Test with Stripe CLI');
      expect(output).toContain('Add error handling');
    });

    it('should format related links', () => {
      const output = formatMentalContext({
        currentTask: 'Testing',
        blockers: [],
        nextSteps: [],
        relatedLinks: [{ title: 'Stripe Docs', url: 'https://stripe.com/docs' }],
        breadcrumbs: [],
      });

      expect(output).toContain('Related');
      expect(output).toContain('Stripe Docs');
      expect(output).toContain('https://stripe.com/docs');
    });

    it('should format breadcrumbs', () => {
      const output = formatMentalContext({
        currentTask: 'Testing',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [{ note: 'Started at line 23', timestamp: new Date().toISOString() }],
      });

      expect(output).toContain('Breadcrumbs');
      expect(output).toContain('Started at line 23');
    });

    it('should format last working on info', () => {
      const output = formatMentalContext({
        currentTask: 'Testing',
        lastWorkingOn: {
          file: 'src/webhooks/stripe.ts',
          line: 45,
          description: 'Adding signature verification',
          timestamp: new Date().toISOString(),
        },
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      });

      expect(output).toContain('src/webhooks/stripe.ts:45');
      expect(output).toContain('Adding signature verification');
    });
  });
});
