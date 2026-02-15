import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// --- Mock child_process ---
const mockExecSync = jest.fn<(...args: unknown[]) => Buffer>().mockReturnValue(Buffer.from(''));

jest.unstable_mockModule('node:child_process', () => ({
  execSync: mockExecSync,
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

// Mock simple-git for commitState
jest.unstable_mockModule('simple-git', () => ({
  simpleGit: jest.fn().mockReturnValue({
    add: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    commit: jest.fn<() => Promise<{ commit: string }>>().mockResolvedValue({ commit: 'abc123' }),
    status: jest.fn<() => Promise<{ files: Array<{ path: string }> }>>().mockResolvedValue({ files: [{ path: 'docker-state.age' }] }),
  }),
  default: jest.fn(),
}));

// Import modules under test (after mocks)
const { generateKey } = await import('../../src/core/encryption.js');
const { saveKey } = await import('../../src/core/key-store.js');
const { writeState } = await import('../../src/core/state-manager.js');

const {
  executeDockerTrack,
  executeDockerStart,
  executeDockerStop,
  executeDockerStatus,
  buildDockerStartCommands,
  resolveDockerComposeDir,
} = await import('../../src/commands/docker.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_COMPOSE = `
services:
  postgres:
    image: postgres:15
    container_name: my-app-db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
`;

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const homeDir = path.join(
    globalThis.TEST_DIR,
    `docker-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(homeDir, '.config', 'ctx-sync');
  const syncDir = path.join(homeDir, '.context-sync');
  const projectDir = path.join(homeDir, 'projects', 'my-app');

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });

  const { publicKey, privateKey } = await generateKey();
  saveKey(configDir, privateKey);

  process.env['CTX_SYNC_HOME'] = homeDir;

  return { homeDir, configDir, syncDir, projectDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Docker Commands', () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env['CTX_SYNC_HOME'];
    mockExecSync.mockReset();
    mockExecSync.mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env['CTX_SYNC_HOME'] = originalHome;
    } else {
      delete process.env['CTX_SYNC_HOME'];
    }
  });

  // ─── executeDockerTrack ─────────────────────────────────────────────────

  describe('executeDockerTrack()', () => {
    it('should track Docker services from compose file', async () => {
      const { projectDir } = await setupTestEnv();
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const result = await executeDockerTrack({
        path: projectDir,
        project: 'my-app',
        noSync: true,
      });

      expect(result.projectName).toBe('my-app');
      expect(result.serviceCount).toBe(2);
      expect(result.serviceNames).toContain('postgres');
      expect(result.serviceNames).toContain('redis');
      expect(result.composeFile).toBe(path.join(projectDir, 'docker-compose.yml'));
    });

    it('should throw when no compose file found', async () => {
      const { projectDir } = await setupTestEnv();

      await expect(
        executeDockerTrack({ path: projectDir, project: 'my-app', noSync: true }),
      ).rejects.toThrow('No Docker Compose file found');
    });

    it('should encrypt Docker state on disk', async () => {
      const { projectDir, syncDir } = await setupTestEnv();
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      await executeDockerTrack({
        path: projectDir,
        project: 'my-app',
        noSync: true,
      });

      const raw = fs.readFileSync(path.join(syncDir, 'docker-state.age'), 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('postgres');
      expect(raw).not.toContain('my-app');
    });

    it('should throw when sync dir does not exist', async () => {
      const homeDir = path.join(
        globalThis.TEST_DIR,
        `docker-nosync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      const configDir = path.join(homeDir, '.config', 'ctx-sync');
      fs.mkdirSync(configDir, { recursive: true });

      const { privateKey } = await generateKey();
      saveKey(configDir, privateKey);

      process.env['CTX_SYNC_HOME'] = homeDir;

      await expect(
        executeDockerTrack({ path: homeDir, project: 'test', noSync: true }),
      ).rejects.toThrow('No sync repository found');
    });
  });

  // ─── buildDockerStartCommands ───────────────────────────────────────────

  describe('buildDockerStartCommands()', () => {
    it('should build commands for auto-start services', () => {
      // Create the directory so path resolution finds the stored compose dir
      const composeDir = path.join(globalThis.TEST_DIR, `docker-bsc-${Date.now()}`);
      fs.mkdirSync(composeDir, { recursive: true });

      const projectDocker = {
        composeFile: path.join(composeDir, 'docker-compose.yml'),
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
            autoStart: true,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);
      expect(commands).toHaveLength(2);
      expect(commands[0]!.command).toBe('docker compose up -d postgres');
      expect(commands[0]!.label).toBe('🐳 Docker services');
      expect(commands[0]!.port).toBe(5432);
      expect(commands[0]!.image).toBe('postgres:15');
      expect(commands[0]!.cwd).toBe(composeDir);
    });

    it('should skip services with autoStart=false', () => {
      const projectDocker = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          {
            name: 'postgres',
            container: 'db',
            image: 'postgres:15',
            port: 5432,
            autoStart: true,
          },
          {
            name: 'debug-tool',
            container: 'debug',
            image: 'debug:latest',
            port: 0,
            autoStart: false,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);
      expect(commands).toHaveLength(1);
      expect(commands[0]!.command).toContain('postgres');
    });

    it('should return empty array for no services', () => {
      const projectDocker = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);
      expect(commands).toHaveLength(0);
    });

    it('should omit port when port is 0', () => {
      const projectDocker = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          {
            name: 'worker',
            container: 'worker',
            image: 'worker:latest',
            port: 0,
            autoStart: true,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);
      expect(commands[0]!.port).toBeUndefined();
    });

    it('should omit image when empty', () => {
      const projectDocker = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          {
            name: 'custom',
            container: 'custom',
            image: '',
            port: 3000,
            autoStart: true,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);
      expect(commands[0]!.image).toBeUndefined();
    });
  });

  // ─── executeDockerStart ─────────────────────────────────────────────────

  describe('executeDockerStart()', () => {
    it('should present commands for approval in non-interactive mode', async () => {
      const { projectDir, syncDir, publicKey } = await setupTestEnv();

      // Write Docker state manually
      const dockerState = {
        'my-app': {
          composeFile: path.join(projectDir, 'docker-compose.yml'),
          services: [
            {
              name: 'postgres',
              container: 'my-app-db',
              image: 'postgres:15',
              port: 5432,
              autoStart: true,
            },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      const result = await executeDockerStart('my-app', { noInteractive: true });

      expect(result.commandsPresented).toHaveLength(1);
      expect(result.approval.skippedAll).toBe(true);
      expect(result.executedCommands).toHaveLength(0);
    });

    it('should not auto-execute any commands', async () => {
      const { projectDir, syncDir, publicKey } = await setupTestEnv();

      const dockerState = {
        'my-app': {
          composeFile: path.join(projectDir, 'docker-compose.yml'),
          services: [
            {
              name: 'postgres',
              container: 'db',
              image: 'postgres:15',
              port: 5432,
              autoStart: true,
            },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      const result = await executeDockerStart('my-app', { noInteractive: true });

      // No commands should be executed in non-interactive mode
      expect(result.executedCommands).toHaveLength(0);
      expect(result.approval.rejected).toHaveLength(1);
    });

    it('should throw for non-existent project', async () => {
      await setupTestEnv();

      await expect(
        executeDockerStart('nonexistent', { noInteractive: true }),
      ).rejects.toThrow('No Docker state found');
    });

    it('should return empty result when no auto-start services', async () => {
      const { projectDir, syncDir, publicKey } = await setupTestEnv();

      const dockerState = {
        'my-app': {
          composeFile: path.join(projectDir, 'docker-compose.yml'),
          services: [
            {
              name: 'postgres',
              container: 'db',
              image: 'postgres:15',
              port: 5432,
              autoStart: false,
            },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      const result = await executeDockerStart('my-app', { noInteractive: true });
      expect(result.commandsPresented).toHaveLength(0);
    });

    it('should execute approved commands in interactive mode', async () => {
      const { projectDir, syncDir, publicKey } = await setupTestEnv();

      const dockerState = {
        'my-app': {
          composeFile: path.join(projectDir, 'docker-compose.yml'),
          services: [
            {
              name: 'postgres',
              container: 'db',
              image: 'postgres:15',
              port: 5432,
              autoStart: true,
            },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      mockExecSync.mockReturnValue(Buffer.from(''));

      const result = await executeDockerStart('my-app', {
        noInteractive: false,
        promptFn: async () => 'all',
      });

      expect(result.approval.approved).toHaveLength(1);
      expect(result.executedCommands).toHaveLength(1);
      expect(result.executedCommands[0]).toContain('docker compose up -d postgres');
    });
  });

  // ─── resolveDockerComposeDir ────────────────────────────────────────────

  describe('resolveDockerComposeDir()', () => {
    it('should return --path override when provided', () => {
      const dir = path.join(globalThis.TEST_DIR, `docker-rcd-override-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });

      const result = resolveDockerComposeDir('/nonexistent/project/docker-compose.yml', { localPath: dir });

      expect(result.resolvedDir).toBe(dir);
      expect(result.pathResolved).toBe(true);
    });

    it('should return stored compose dir when it exists on disk', () => {
      const dir = path.join(globalThis.TEST_DIR, `docker-rcd-exists-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      const composeFile = path.join(dir, 'docker-compose.yml');

      const result = resolveDockerComposeDir(composeFile);

      expect(result.resolvedDir).toBe(dir);
      expect(result.pathResolved).toBe(false);
    });

    it('should fall back to cwd when stored compose dir is missing and no --path', () => {
      const result = resolveDockerComposeDir('/nonexistent/project/docker-compose.yml');

      expect(result.resolvedDir).toBe(process.cwd());
      expect(result.pathResolved).toBe(true);
    });

    it('should resolve relative --path to absolute', () => {
      const result = resolveDockerComposeDir('/nonexistent/project/docker-compose.yml', { localPath: '.' });

      expect(path.isAbsolute(result.resolvedDir)).toBe(true);
      expect(result.resolvedDir).toBe(path.resolve('.'));
    });

    it('should set pathResolved to false when --path matches stored dir', () => {
      const dir = path.join(globalThis.TEST_DIR, `docker-rcd-same-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      const composeFile = path.join(dir, 'docker-compose.yml');

      const result = resolveDockerComposeDir(composeFile, { localPath: dir });

      expect(result.resolvedDir).toBe(dir);
      expect(result.pathResolved).toBe(false);
    });
  });

  // ─── buildDockerStartCommands (cross-machine) ────────────────────────────

  describe('buildDockerStartCommands() cross-machine', () => {
    it('should use --path override for cwd when stored compose dir does not exist', () => {
      const overrideDir = path.join(globalThis.TEST_DIR, `docker-bsc-override-${Date.now()}`);
      fs.mkdirSync(overrideDir, { recursive: true });

      const projectDocker = {
        composeFile: '/nonexistent/macOS/project/docker-compose.yml',
        services: [
          {
            name: 'postgres',
            container: 'db',
            image: 'postgres:15',
            port: 5432,
            autoStart: true,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker, overrideDir);
      expect(commands).toHaveLength(1);
      expect(commands[0]!.cwd).toBe(overrideDir);
    });

    it('should use stored dir when it exists even if localPath is not provided', () => {
      const dir = path.join(globalThis.TEST_DIR, `docker-bsc-stored-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });

      const projectDocker = {
        composeFile: path.join(dir, 'docker-compose.yml'),
        services: [
          {
            name: 'redis',
            container: 'cache',
            image: 'redis:7',
            port: 6379,
            autoStart: true,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);
      expect(commands).toHaveLength(1);
      expect(commands[0]!.cwd).toBe(dir);
    });

    it('should fall back to cwd when stored compose dir is missing and no localPath', () => {
      const projectDocker = {
        composeFile: '/nonexistent/macOS/project/docker-compose.yml',
        services: [
          {
            name: 'postgres',
            container: 'db',
            image: 'postgres:15',
            port: 5432,
            autoStart: true,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);
      expect(commands).toHaveLength(1);
      expect(commands[0]!.cwd).toBe(process.cwd());
    });
  });

  // ─── executeDockerStop ─────────────────────────────────────────────────

  describe('executeDockerStop()', () => {
    it('should return composeFound: false when no Docker state exists', async () => {
      await setupTestEnv();

      const result = await executeDockerStop('nonexistent');
      expect(result.composeFound).toBe(false);
      expect(result.stopped).toBe(false);
    });

    it('should use --path override when stored compose dir does not exist', async () => {
      const { syncDir, publicKey, homeDir } = await setupTestEnv();

      // Create override dir with a compose file
      const overrideDir = path.join(homeDir, 'override', 'my-app');
      fs.mkdirSync(overrideDir, { recursive: true });
      fs.writeFileSync(path.join(overrideDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const dockerState = {
        'my-app': {
          composeFile: '/nonexistent/macOS/my-app/docker-compose.yml',
          services: [
            { name: 'postgres', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      mockExecSync.mockReturnValue(Buffer.from(''));

      const result = await executeDockerStop('my-app', { localPath: overrideDir });

      expect(result.composeFound).toBe(true);
      expect(result.pathResolved).toBe(true);
      expect(result.localPath).toBe(overrideDir);
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker compose down',
        expect.objectContaining({ cwd: overrideDir }),
      );
    });

    it('should include pathResolved in result', async () => {
      const { projectDir, syncDir, publicKey } = await setupTestEnv();

      const dockerState = {
        'my-app': {
          composeFile: path.join(projectDir, 'docker-compose.yml'),
          services: [
            { name: 'postgres', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      mockExecSync.mockReturnValue(Buffer.from(''));

      const result = await executeDockerStop('my-app');

      expect(result.pathResolved).toBe(false);
      expect(result.localPath).toBe(projectDir);
    });
  });

  // ─── executeDockerStart (cross-machine) ────────────────────────────────

  describe('executeDockerStart() cross-machine', () => {
    it('should use --path override when stored compose dir does not exist', async () => {
      const { syncDir, publicKey, homeDir } = await setupTestEnv();

      const overrideDir = path.join(homeDir, 'override', 'my-app');
      fs.mkdirSync(overrideDir, { recursive: true });

      const dockerState = {
        'my-app': {
          composeFile: '/nonexistent/macOS/my-app/docker-compose.yml',
          services: [
            { name: 'postgres', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      mockExecSync.mockReturnValue(Buffer.from(''));

      const result = await executeDockerStart('my-app', {
        noInteractive: false,
        localPath: overrideDir,
        promptFn: async () => 'all',
      });

      expect(result.pathResolved).toBe(true);
      expect(result.localPath).toBe(overrideDir);
      expect(result.executedCommands).toHaveLength(1);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker compose up -d postgres'),
        expect.objectContaining({ cwd: overrideDir }),
      );
    });

    it('should include pathResolved: false when stored dir exists', async () => {
      const { projectDir, syncDir, publicKey } = await setupTestEnv();

      const dockerState = {
        'my-app': {
          composeFile: path.join(projectDir, 'docker-compose.yml'),
          services: [
            { name: 'postgres', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      const result = await executeDockerStart('my-app', { noInteractive: true });

      expect(result.pathResolved).toBe(false);
      expect(result.localPath).toBe(projectDir);
    });
  });

  // ─── executeDockerStatus ────────────────────────────────────────────────

  describe('executeDockerStatus()', () => {
    it('should return all tracked projects', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      const dockerState = {
        'app1': {
          composeFile: '/projects/app1/docker-compose.yml',
          services: [
            { name: 'db', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
          ],
        },
        'app2': {
          composeFile: '/projects/app2/docker-compose.yml',
          services: [
            { name: 'cache', container: 'cache', image: 'redis:7', port: 6379, autoStart: true },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      const result = await executeDockerStatus();
      expect(result.projects).toHaveLength(2);
    });

    it('should filter by project name', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      const dockerState = {
        'app1': {
          composeFile: '/projects/app1/docker-compose.yml',
          services: [
            { name: 'db', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
          ],
        },
        'app2': {
          composeFile: '/projects/app2/docker-compose.yml',
          services: [
            { name: 'cache', container: 'cache', image: 'redis:7', port: 6379, autoStart: true },
          ],
        },
      };
      await writeState(syncDir, dockerState, publicKey, 'docker-state');

      const result = await executeDockerStatus('app1');
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0]!.projectName).toBe('app1');
    });

    it('should return empty when no Docker state exists', async () => {
      await setupTestEnv();

      const result = await executeDockerStatus();
      expect(result.projects).toHaveLength(0);
    });
  });
});
