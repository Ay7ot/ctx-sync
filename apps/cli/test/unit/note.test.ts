import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

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

// Mock enquirer (not needed for unit tests that use promptFn override)
jest.unstable_mockModule('enquirer', () => ({
  default: class MockEnquirer {
    prompt = jest.fn<() => Promise<Record<string, string>>>().mockResolvedValue({});
  },
}));

// Import modules under test (after mocks)
const {
  executeNote,
  parseFileReference,
  parseLink,
  createEmptyContext,
  mergeContext,
  buildInputFromFlags,
} = await import('../../src/commands/note.js');
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
  const homeDir = path.join(
    globalThis.TEST_DIR,
    `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
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

// Helper to write a project to state
async function writeProject(
  syncDir: string,
  publicKey: string,
  projectName: string,
  projectPath: string,
): Promise<void> {
  await writeState(
    syncDir,
    {
      machine: { id: 'test', hostname: 'test-host' },
      projects: [
        {
          id: `${projectName}-id`,
          name: projectName,
          path: projectPath,
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
      ],
    },
    publicKey,
    'state',
  );
}

describe('Note Command', () => {
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

  describe('parseFileReference()', () => {
    it('should parse file:line:col', () => {
      const result = parseFileReference('src/webhooks/stripe.ts:45:12');
      expect(result).toEqual({
        file: 'src/webhooks/stripe.ts',
        line: 45,
        column: 12,
      });
    });

    it('should parse file:line', () => {
      const result = parseFileReference('src/index.ts:100');
      expect(result).toEqual({
        file: 'src/index.ts',
        line: 100,
        column: undefined,
      });
    });

    it('should parse file only', () => {
      const result = parseFileReference('src/index.ts');
      expect(result).toEqual({
        file: 'src/index.ts',
        line: 0,
        column: undefined,
      });
    });

    it('should return null for empty string', () => {
      expect(parseFileReference('')).toBeNull();
      expect(parseFileReference('   ')).toBeNull();
    });
  });

  describe('parseLink()', () => {
    it('should parse a plain URL', () => {
      const result = parseLink('https://stripe.com/docs');
      expect(result).toEqual({
        title: 'https://stripe.com/docs',
        url: 'https://stripe.com/docs',
      });
    });

    it('should parse "Title: URL" format', () => {
      const result = parseLink('Stripe Docs: https://stripe.com/docs');
      expect(result).toEqual({
        title: 'Stripe Docs',
        url: 'https://stripe.com/docs',
      });
    });

    it('should parse "Title - URL" format', () => {
      const result = parseLink('PR #789 - https://github.com/company/repo/pull/789');
      expect(result).toEqual({
        title: 'PR #789',
        url: 'https://github.com/company/repo/pull/789',
      });
    });

    it('should handle trimming', () => {
      const result = parseLink('  Docs:  https://example.com  ');
      expect(result.title).toBe('Docs');
      expect(result.url).toBe('https://example.com');
    });
  });

  describe('createEmptyContext()', () => {
    it('should return a blank context', () => {
      const ctx = createEmptyContext();
      expect(ctx.currentTask).toBe('');
      expect(ctx.blockers).toEqual([]);
      expect(ctx.nextSteps).toEqual([]);
      expect(ctx.relatedLinks).toEqual([]);
      expect(ctx.breadcrumbs).toEqual([]);
      expect(ctx.lastWorkingOn).toBeUndefined();
    });
  });

  describe('mergeContext()', () => {
    it('should create new context from null existing', () => {
      const result = mergeContext(null, {
        currentTask: 'Implementing auth',
        blockers: ['Waiting for creds'],
        nextSteps: ['Add tests'],
      });

      expect(result.currentTask).toBe('Implementing auth');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]?.description).toBe('Waiting for creds');
      expect(result.nextSteps).toEqual(['Add tests']);
    });

    it('should replace currentTask when provided', () => {
      const existing = createEmptyContext();
      existing.currentTask = 'Old task';

      const result = mergeContext(existing, {
        currentTask: 'New task',
      });

      expect(result.currentTask).toBe('New task');
    });

    it('should keep existing currentTask when not provided', () => {
      const existing = createEmptyContext();
      existing.currentTask = 'Existing task';

      const result = mergeContext(existing, {});

      expect(result.currentTask).toBe('Existing task');
    });

    it('should append blockers without duplicates', () => {
      const existing = createEmptyContext();
      existing.blockers = [
        { description: 'Waiting for API keys', addedAt: '2025-01-01', priority: 'high' },
      ];

      const result = mergeContext(existing, {
        blockers: ['Waiting for API keys', 'Need staging env'],
      });

      expect(result.blockers).toHaveLength(2);
      expect(result.blockers[0]?.description).toBe('Waiting for API keys');
      expect(result.blockers[1]?.description).toBe('Need staging env');
    });

    it('should handle case-insensitive blocker dedup', () => {
      const existing = createEmptyContext();
      existing.blockers = [
        { description: 'Waiting for keys', addedAt: '2025-01-01', priority: 'medium' },
      ];

      const result = mergeContext(existing, {
        blockers: ['WAITING FOR KEYS'],
      });

      expect(result.blockers).toHaveLength(1);
    });

    it('should append next steps without duplicates', () => {
      const existing = createEmptyContext();
      existing.nextSteps = ['Add tests'];

      const result = mergeContext(existing, {
        nextSteps: ['Add tests', 'Deploy to staging'],
      });

      expect(result.nextSteps).toHaveLength(2);
      expect(result.nextSteps).toContain('Add tests');
      expect(result.nextSteps).toContain('Deploy to staging');
    });

    it('should append related links without duplicates', () => {
      const existing = createEmptyContext();
      existing.relatedLinks = [
        { title: 'Stripe', url: 'https://stripe.com' },
      ];

      const result = mergeContext(existing, {
        relatedLinks: [
          { title: 'Stripe', url: 'https://stripe.com' },
          { title: 'Docs', url: 'https://docs.example.com' },
        ],
      });

      expect(result.relatedLinks).toHaveLength(2);
    });

    it('should append breadcrumb', () => {
      const existing = createEmptyContext();
      existing.breadcrumbs = [
        { note: 'Started at line 23', timestamp: '2025-01-01' },
      ];

      const result = mergeContext(existing, {
        breadcrumb: 'Fixed the bug at line 45',
      });

      expect(result.breadcrumbs).toHaveLength(2);
      expect(result.breadcrumbs[1]?.note).toBe('Fixed the bug at line 45');
    });

    it('should skip empty breadcrumb', () => {
      const existing = createEmptyContext();

      const result = mergeContext(existing, {
        breadcrumb: '   ',
      });

      expect(result.breadcrumbs).toHaveLength(0);
    });

    it('should update lastWorkingOn when provided', () => {
      const result = mergeContext(null, {
        lastWorkingOn: {
          file: 'src/index.ts',
          line: 42,
          column: 10,
          description: 'Adding auth handler',
        },
      });

      expect(result.lastWorkingOn).toBeDefined();
      expect(result.lastWorkingOn?.file).toBe('src/index.ts');
      expect(result.lastWorkingOn?.line).toBe(42);
      expect(result.lastWorkingOn?.column).toBe(10);
      expect(result.lastWorkingOn?.description).toBe('Adding auth handler');
      expect(result.lastWorkingOn?.timestamp).toBeDefined();
    });

    it('should skip empty blockers and steps', () => {
      const result = mergeContext(null, {
        blockers: ['', '  ', 'real blocker'],
        nextSteps: ['', 'real step'],
      });

      expect(result.blockers).toHaveLength(1);
      expect(result.nextSteps).toHaveLength(1);
    });
  });

  describe('buildInputFromFlags()', () => {
    it('should map all flags to input', () => {
      const input = buildInputFromFlags({
        task: 'My task',
        blockers: ['blocker1', 'blocker2'],
        nextSteps: ['step1'],
        links: ['https://example.com'],
        breadcrumb: 'A note',
        file: 'src/index.ts:42:10',
        fileDescription: 'Adding auth',
      });

      expect(input.currentTask).toBe('My task');
      expect(input.blockers).toEqual(['blocker1', 'blocker2']);
      expect(input.nextSteps).toEqual(['step1']);
      expect(input.relatedLinks).toHaveLength(1);
      expect(input.breadcrumb).toBe('A note');
      expect(input.lastWorkingOn?.file).toBe('src/index.ts');
      expect(input.lastWorkingOn?.line).toBe(42);
    });

    it('should handle empty options', () => {
      const input = buildInputFromFlags({});
      expect(input.currentTask).toBeUndefined();
      expect(input.blockers).toBeUndefined();
      expect(input.nextSteps).toBeUndefined();
      expect(input.relatedLinks).toBeUndefined();
      expect(input.breadcrumb).toBeUndefined();
      expect(input.lastWorkingOn).toBeUndefined();
    });
  });

  describe('executeNote()', () => {
    it('should throw if no sync repo exists', async () => {
      const homeDir = path.join(
        globalThis.TEST_DIR,
        `note-nosync-${Date.now()}`,
      );
      fs.mkdirSync(homeDir, { recursive: true });
      process.env['CTX_SYNC_HOME'] = homeDir;

      await expect(executeNote('my-app')).rejects.toThrow(
        'No sync repository found',
      );
    });

    it('should throw if no state file exists', async () => {
      await setupTestEnv();

      await expect(executeNote('my-app')).rejects.toThrow(
        'No state file found',
      );
    });

    it('should throw if project not found', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'other-project', '/path/to/other');

      await expect(executeNote('nonexistent')).rejects.toThrow(
        'Project "nonexistent" not found',
      );
    });

    it('should list available projects in error', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      await expect(executeNote('wrong')).rejects.toThrow('my-app');
    });

    it('should create new mental context', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      const result = await executeNote('my-app', {
        noInteractive: true,
        noSync: true,
        task: 'Implementing Stripe webhooks',
        blockers: ['Waiting for API keys'],
        nextSteps: ['Test with Stripe CLI', 'Add error handling'],
        promptFn: async () => ({
          currentTask: 'Implementing Stripe webhooks',
          blockers: ['Waiting for API keys'],
          nextSteps: ['Test with Stripe CLI', 'Add error handling'],
        }),
      });

      expect(result.isNew).toBe(true);
      expect(result.projectName).toBe('my-app');
      expect(result.context.currentTask).toBe('Implementing Stripe webhooks');
      expect(result.context.blockers).toHaveLength(1);
      expect(result.context.nextSteps).toHaveLength(2);
    });

    it('should update existing mental context', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      // Create initial context
      await writeState(
        syncDir,
        {
          'my-app': {
            currentTask: 'Initial task',
            blockers: [],
            nextSteps: ['Step 1'],
            relatedLinks: [],
            breadcrumbs: [],
          },
        },
        publicKey,
        'mental-context',
      );

      const result = await executeNote('my-app', {
        noSync: true,
        promptFn: async () => ({
          currentTask: 'Updated task',
          nextSteps: ['Step 2'],
          breadcrumb: 'Changed approach',
        }),
      });

      expect(result.isNew).toBe(false);
      expect(result.context.currentTask).toBe('Updated task');
      expect(result.context.nextSteps).toContain('Step 1');
      expect(result.context.nextSteps).toContain('Step 2');
      expect(result.context.breadcrumbs).toHaveLength(1);
    });

    it('should merge without overwriting existing data', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      // Create initial context with data
      await writeState(
        syncDir,
        {
          'my-app': {
            currentTask: 'Original task',
            blockers: [
              {
                description: 'Existing blocker',
                addedAt: new Date().toISOString(),
                priority: 'high' as const,
              },
            ],
            nextSteps: ['Existing step'],
            relatedLinks: [
              { title: 'Existing', url: 'https://existing.com' },
            ],
            breadcrumbs: [
              { note: 'Previous crumb', timestamp: new Date().toISOString() },
            ],
          },
        },
        publicKey,
        'mental-context',
      );

      const result = await executeNote('my-app', {
        noSync: true,
        promptFn: async () => ({
          blockers: ['New blocker'],
          nextSteps: ['New step'],
          relatedLinks: [{ title: 'New', url: 'https://new.com' }],
          breadcrumb: 'New crumb',
        }),
      });

      // Existing data should be preserved
      expect(result.context.currentTask).toBe('Original task');
      expect(result.context.blockers).toHaveLength(2);
      expect(result.context.nextSteps).toHaveLength(2);
      expect(result.context.relatedLinks).toHaveLength(2);
      expect(result.context.breadcrumbs).toHaveLength(2);
    });

    it('should use non-interactive flags when noInteractive is true', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      const result = await executeNote('my-app', {
        noInteractive: true,
        noSync: true,
        task: 'CLI task',
        blockers: ['CLI blocker'],
        nextSteps: ['CLI step'],
        breadcrumb: 'CLI breadcrumb',
      });

      expect(result.context.currentTask).toBe('CLI task');
      expect(result.context.blockers).toHaveLength(1);
      expect(result.context.blockers[0]?.description).toBe('CLI blocker');
      expect(result.context.nextSteps).toEqual(['CLI step']);
      expect(result.context.breadcrumbs).toHaveLength(1);
    });

    it('should write encrypted mental-context.age', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      await executeNote('my-app', {
        noSync: true,
        promptFn: async () => ({
          currentTask: 'Secret task info',
        }),
      });

      // Verify the file on disk is encrypted
      const filePath = path.join(syncDir, 'mental-context.age');
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('Secret task info');
      expect(raw).not.toContain('my-app');
    });

    it('should find project by ID', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'unique-note-id',
              name: 'my-app',
              path: '/path/to/app',
              git: {
                branch: 'main',
                remote: '',
                hasUncommitted: false,
                stashCount: 0,
              },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        publicKey,
        'state',
      );

      const result = await executeNote('unique-note-id', {
        noSync: true,
        promptFn: async () => ({
          currentTask: 'Found by ID',
        }),
      });

      expect(result.projectName).toBe('my-app');
      expect(result.context.currentTask).toBe('Found by ID');
    });
  });
});
