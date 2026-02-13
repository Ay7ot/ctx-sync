import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// Mock chalk
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

// Import modules under test (after mocks)
const { executeShow, formatShowOutput } = await import(
  '../../src/commands/show.js'
);
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
    `show-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(homeDir, '.config', 'ctx-sync');
  const syncDir = path.join(homeDir, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });

  // Generate and save key
  const { publicKey, privateKey } = await generateKey();
  saveKey(configDir, privateKey);

  process.env['CTX_SYNC_HOME'] = homeDir;

  return { homeDir, configDir, syncDir, privateKey, publicKey };
}

// Helper to write a project to state
async function writeProject(
  syncDir: string,
  publicKey: string,
  projectName: string,
  projectPath: string,
  gitBranch = 'main',
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
            branch: gitBranch,
            remote: 'origin',
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

describe('Show Command', () => {
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

  describe('executeShow()', () => {
    it('should throw if no sync repo exists', async () => {
      const homeDir = path.join(
        globalThis.TEST_DIR,
        `show-nosync-${Date.now()}`,
      );
      fs.mkdirSync(homeDir, { recursive: true });
      process.env['CTX_SYNC_HOME'] = homeDir;

      await expect(executeShow('my-app')).rejects.toThrow(
        'No sync repository found',
      );
    });

    it('should throw if no state file exists', async () => {
      await setupTestEnv();

      await expect(executeShow('my-app')).rejects.toThrow(
        'No state file found',
      );
    });

    it('should throw if project not found', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'other-project', '/path/to/other');

      await expect(executeShow('nonexistent')).rejects.toThrow(
        'Project "nonexistent" not found',
      );
    });

    it('should list available projects in error', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      await expect(executeShow('wrong')).rejects.toThrow('my-app');
    });

    it('should return basic project info', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(
        syncDir,
        publicKey,
        'my-app',
        '/home/user/projects/my-app',
        'feature/payments',
      );

      const result = await executeShow('my-app');

      expect(result.project.name).toBe('my-app');
      expect(result.project.path).toBe('/home/user/projects/my-app');
      expect(result.project.git.branch).toBe('feature/payments');
      expect(result.envVarCount).toBe(0);
      expect(result.mentalContext).toBeNull();
      expect(result.dockerServices).toEqual([]);
      expect(result.services).toEqual([]);
    });

    it('should count env vars correctly', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      await writeState(
        syncDir,
        {
          'my-app': {
            NODE_ENV: {
              value: 'development',
              addedAt: new Date().toISOString(),
            },
            PORT: { value: '3000', addedAt: new Date().toISOString() },
            SECRET: { value: 'sk_test_123', addedAt: new Date().toISOString() },
          },
        },
        publicKey,
        'env-vars',
      );

      const result = await executeShow('my-app');

      expect(result.envVarCount).toBe(3);
    });

    it('should load mental context when available', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      await writeState(
        syncDir,
        {
          'my-app': {
            currentTask: 'Implementing Stripe webhooks',
            lastWorkingOn: {
              file: 'src/webhooks/stripe.ts',
              line: 45,
              description: 'Adding signature verification',
              timestamp: new Date().toISOString(),
            },
            blockers: [
              {
                description: 'Waiting for API keys',
                addedAt: new Date().toISOString(),
                priority: 'high' as const,
              },
            ],
            nextSteps: ['Test with Stripe CLI', 'Add error handling'],
            relatedLinks: [
              {
                title: 'Stripe Docs',
                url: 'https://stripe.com/docs/webhooks',
              },
            ],
            breadcrumbs: [
              {
                note: 'Started at line 23',
                timestamp: new Date().toISOString(),
              },
            ],
          },
        },
        publicKey,
        'mental-context',
      );

      const result = await executeShow('my-app');

      expect(result.mentalContext).not.toBeNull();
      expect(result.mentalContext?.currentTask).toBe(
        'Implementing Stripe webhooks',
      );
      expect(result.mentalContext?.lastWorkingOn?.file).toBe(
        'src/webhooks/stripe.ts',
      );
      expect(result.mentalContext?.blockers).toHaveLength(1);
      expect(result.mentalContext?.nextSteps).toHaveLength(2);
      expect(result.mentalContext?.relatedLinks).toHaveLength(1);
      expect(result.mentalContext?.breadcrumbs).toHaveLength(1);
    });

    it('should load Docker services when available', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      await writeState(
        syncDir,
        {
          'my-app': {
            composeFile: '/path/to/app/docker-compose.yml',
            services: [
              {
                name: 'postgres',
                container: 'my-app-db',
                image: 'postgres:15',
                port: 5432,
                autoStart: true,
              },
              {
                name: 'redis',
                container: 'my-app-redis',
                image: 'redis:7-alpine',
                port: 6379,
                autoStart: false,
              },
            ],
          },
        },
        publicKey,
        'docker-state',
      );

      const result = await executeShow('my-app');

      expect(result.dockerServices).toHaveLength(2);
      expect(result.dockerServices[0]?.name).toBe('postgres');
      expect(result.dockerServices[0]?.image).toBe('postgres:15');
      expect(result.dockerServices[0]?.port).toBe(5432);
      expect(result.dockerServices[0]?.autoStart).toBe(true);
      expect(result.dockerServices[1]?.name).toBe('redis');
    });

    it('should load running services when available', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeProject(syncDir, publicKey, 'my-app', '/path/to/app');

      await writeState(
        syncDir,
        {
          services: [
            {
              project: 'my-app',
              name: 'dev-server',
              port: 3000,
              command: 'npm run dev',
              autoStart: true,
            },
            {
              project: 'other-project',
              name: 'api',
              port: 4000,
              command: 'npm run api',
              autoStart: true,
            },
          ],
        },
        publicKey,
        'services',
      );

      const result = await executeShow('my-app');

      // Should only include services for my-app
      expect(result.services).toHaveLength(1);
      expect(result.services[0]?.name).toBe('dev-server');
      expect(result.services[0]?.command).toBe('npm run dev');
    });

    it('should find project by ID', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        {
          machine: { id: 'test', hostname: 'test-host' },
          projects: [
            {
              id: 'unique-show-id',
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

      const result = await executeShow('unique-show-id');

      expect(result.project.name).toBe('my-app');
    });
  });

  describe('formatShowOutput()', () => {
    it('should format basic project info', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/home/user/projects/my-app',
          git: {
            branch: 'feature/payments',
            remote: 'origin',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 5,
        mentalContext: null,
        dockerServices: [],
        services: [],
      });

      expect(output).toContain('my-app');
      expect(output).toContain('/home/user/projects/my-app');
      expect(output).toContain('feature/payments');
      expect(output).toContain('5');
    });

    it('should show uncommitted changes indicator', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/path',
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: true,
            stashCount: 2,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 0,
        mentalContext: null,
        dockerServices: [],
        services: [],
      });

      expect(output).toContain('Uncommitted changes');
      expect(output).toContain('Stash count: 2');
    });

    it('should format mental context section', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/path',
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 0,
        mentalContext: {
          currentTask: 'Implementing Stripe webhooks',
          lastWorkingOn: {
            file: 'src/webhooks/stripe.ts',
            line: 45,
            description: 'Adding signature verification',
            timestamp: new Date().toISOString(),
          },
          blockers: [
            {
              description: 'Waiting for API keys',
              addedAt: new Date().toISOString(),
              priority: 'high',
            },
          ],
          nextSteps: ['Test with Stripe CLI', 'Add error handling'],
          relatedLinks: [
            {
              title: 'Stripe Docs',
              url: 'https://stripe.com/docs',
            },
          ],
          breadcrumbs: [
            {
              note: 'Started at line 23',
              timestamp: new Date().toISOString(),
            },
          ],
        },
        dockerServices: [],
        services: [],
      });

      expect(output).toContain('Mental Context');
      expect(output).toContain('Implementing Stripe webhooks');
      expect(output).toContain('src/webhooks/stripe.ts:45');
      expect(output).toContain('Adding signature verification');
      expect(output).toContain('Blockers');
      expect(output).toContain('Waiting for API keys');
      expect(output).toContain('[HIGH]');
      expect(output).toContain('Next Steps');
      expect(output).toContain('Test with Stripe CLI');
      expect(output).toContain('Related Links');
      expect(output).toContain('Stripe Docs');
      expect(output).toContain('Breadcrumbs');
      expect(output).toContain('Started at line 23');
    });

    it('should format Docker services section', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/path',
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 0,
        mentalContext: null,
        dockerServices: [
          {
            name: 'postgres',
            image: 'postgres:15',
            port: 5432,
            autoStart: true,
          },
        ],
        services: [],
      });

      expect(output).toContain('Docker Services');
      expect(output).toContain('postgres');
      expect(output).toContain('postgres:15');
      expect(output).toContain('5432');
      expect(output).toContain('auto-start');
    });

    it('should format running services section', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/path',
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 0,
        mentalContext: null,
        dockerServices: [],
        services: [
          {
            name: 'dev-server',
            port: 3000,
            command: 'npm run dev',
            autoStart: true,
          },
        ],
      });

      expect(output).toContain('Services');
      expect(output).toContain('dev-server');
      expect(output).toContain('npm run dev');
      expect(output).toContain('3000');
    });

    it('should show guidance when no context is recorded', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/path',
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 0,
        mentalContext: null,
        dockerServices: [],
        services: [],
      });

      expect(output).toContain('No additional context recorded');
      expect(output).toContain('ctx-sync note');
      expect(output).toContain('ctx-sync env import');
    });

    it('should handle missing sections gracefully', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/path',
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 3,
        mentalContext: {
          currentTask: 'Working',
          blockers: [],
          nextSteps: [],
          relatedLinks: [],
          breadcrumbs: [],
        },
        dockerServices: [],
        services: [],
      });

      // Should not contain section headers for empty sections
      expect(output).not.toContain('Blockers');
      expect(output).not.toContain('Next Steps');
      expect(output).not.toContain('Related Links');
      expect(output).not.toContain('Breadcrumbs');
      expect(output).not.toContain('Docker Services');
      expect(output).not.toContain('No additional context');
    });

    it('should format links where title equals URL', () => {
      const output = formatShowOutput({
        project: {
          id: 'test-id',
          name: 'my-app',
          path: '/path',
          git: {
            branch: 'main',
            remote: '',
            hasUncommitted: false,
            stashCount: 0,
          },
          lastAccessed: new Date().toISOString(),
        },
        envVarCount: 0,
        mentalContext: {
          currentTask: 'Testing',
          blockers: [],
          nextSteps: [],
          relatedLinks: [
            {
              title: 'https://example.com',
              url: 'https://example.com',
            },
          ],
          breadcrumbs: [],
        },
        dockerServices: [],
        services: [],
      });

      // Should show URL only once, not "https://example.com: https://example.com"
      const linkLines = output
        .split('\n')
        .filter((l) => l.includes('example.com'));
      expect(linkLines).toHaveLength(1);
      expect(linkLines[0]).not.toContain('https://example.com: https://example.com');
    });
  });
});
