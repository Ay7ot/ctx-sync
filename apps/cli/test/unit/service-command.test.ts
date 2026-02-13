import { jest } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// ─── Mocks ────────────────────────────────────────────────────────────────

jest.unstable_mockModule('simple-git', () => ({
  simpleGit: jest.fn().mockReturnValue({
    add: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    commit: jest.fn<() => Promise<{ commit: string }>>().mockResolvedValue({ commit: 'abc123' }),
    status: jest.fn<() => Promise<{ files: Array<{ path: string }> }>>().mockResolvedValue({ files: [{ path: 'services.age' }] }),
  }),
  default: jest.fn(),
}));

const { generateKey } = await import('../../src/core/encryption.js');
const { createService, addService } = await import(
  '../../src/core/services-handler.js'
);
const {
  executeServiceAdd,
  executeServiceRemove,
  executeServiceList,
  executeServiceStart,
  buildServiceStartCommands,
} = await import('../../src/commands/service.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `svc-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  const syncDir = path.join(testHome, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(syncDir, { recursive: true });

  process.env['CTX_SYNC_HOME'] = testHome;

  const { publicKey, privateKey } = await generateKey();
  fs.writeFileSync(path.join(configDir, 'key.txt'), privateKey, {
    mode: 0o600,
  });

  return { testHome, configDir, syncDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Service Command', () => {
  // ── buildServiceStartCommands() ─────────────────────────────────────

  describe('buildServiceStartCommands()', () => {
    it('should build pending commands from services', () => {
      const svc1 = createService('proj', 'api', 3000, 'npm start', true);
      const svc2 = createService('proj', 'db', 5432, 'docker compose up -d postgres', true);

      const commands = buildServiceStartCommands([svc1, svc2]);
      expect(commands).toHaveLength(2);
      expect(commands[0]!.command).toBe('npm start');
      expect(commands[0]!.label).toContain('api');
      expect(commands[0]!.label).toContain('3000');
      expect(commands[1]!.command).toBe('docker compose up -d postgres');
    });

    it('should return empty for no services', () => {
      const commands = buildServiceStartCommands([]);
      expect(commands).toEqual([]);
    });
  });

  // ── executeServiceAdd() ─────────────────────────────────────────────

  describe('executeServiceAdd()', () => {
    it('should add a service and return result', async () => {
      await setupTestEnv();

      const result = await executeServiceAdd('my-project', 'api', {
        port: 3000,
        command: 'npm start',
        autoStart: true,
        noSync: true,
      });

      expect(result.projectName).toBe('my-project');
      expect(result.serviceName).toBe('api');
      expect(result.port).toBe(3000);
      expect(result.command).toBe('npm start');
      expect(result.autoStart).toBe(true);
    });

    it('should reject invalid service', async () => {
      await setupTestEnv();

      await expect(
        executeServiceAdd('proj', 'api', {
          port: 0,
          command: 'npm start',
          noSync: true,
        }),
      ).rejects.toThrow('Invalid service');
    });
  });

  // ── executeServiceRemove() ──────────────────────────────────────────

  describe('executeServiceRemove()', () => {
    it('should remove an existing service', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );

      const removed = await executeServiceRemove('proj', 'api', true);
      expect(removed).toBe(true);
    });

    it('should return false for non-existent service', async () => {
      await setupTestEnv();

      const removed = await executeServiceRemove('proj', 'missing', true);
      expect(removed).toBe(false);
    });
  });

  // ── executeServiceList() ────────────────────────────────────────────

  describe('executeServiceList()', () => {
    it('should list services for a specific project', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj-a', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj-b', 'worker', 4000, 'npm run worker'),
        publicKey,
        privateKey,
      );

      const results = await executeServiceList('proj-a');
      expect(results).toHaveLength(1);
      expect(results[0]!.project).toBe('proj-a');
      expect(results[0]!.services).toHaveLength(1);
    });

    it('should list all services when no project specified', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj-a', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj-b', 'worker', 4000, 'npm run worker'),
        publicKey,
        privateKey,
      );

      const results = await executeServiceList();
      expect(results).toHaveLength(2);
    });
  });

  // ── executeServiceStart() ───────────────────────────────────────────

  describe('executeServiceStart()', () => {
    it('should return empty result when no auto-start services', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start', false),
        publicKey,
        privateKey,
      );

      const result = await executeServiceStart('proj', { noInteractive: true });
      expect(result.commandsPresented).toHaveLength(0);
    });

    it('should show commands in non-interactive mode without executing', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start', true),
        publicKey,
        privateKey,
      );

      const result = await executeServiceStart('proj', { noInteractive: true });
      expect(result.commandsPresented).toHaveLength(1);
      expect(result.executedCommands).toHaveLength(0);
      expect(result.approval.rejected).toHaveLength(1);
    });
  });
});
