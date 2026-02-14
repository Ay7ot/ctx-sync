import { VERSION } from '@ctx-sync/shared';

/**
 * Integration tests for the init workflow.
 *
 * Tests the full init flow with real filesystem operations, real encryption,
 * and real Git (no mocks). Verifies correct directory structure, permissions,
 * and Git repo initialization.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// Import modules under test (no mocks — real operations)
const { executeInit, executeRestore } = await import(
  '../../src/commands/init.js'
);
const { generateKey } = await import('../../src/core/encryption.js');
const { KEY_FILE_PERMS, CONFIG_DIR_PERMS } = await import(
  '../../src/core/key-store.js'
);

describe('Integration: Init Workflow', () => {
  let testHome: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    testHome = path.join(globalThis.TEST_DIR, `init-integ-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });
    originalEnv = process.env['CTX_SYNC_HOME'];
    process.env['CTX_SYNC_HOME'] = testHome;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTX_SYNC_HOME'];
    } else {
      process.env['CTX_SYNC_HOME'] = originalEnv;
    }
  });

  describe('Fresh init creates correct directory structure', () => {
    it('should create config dir, key file, sync dir, and manifest', async () => {
      await executeInit({ noInteractive: true });

      // Config directory exists with 0o700
      const configDir = path.join(testHome, '.config', 'ctx-sync');
      expect(fs.existsSync(configDir)).toBe(true);
      expect(fs.statSync(configDir).mode & 0o777).toBe(CONFIG_DIR_PERMS);

      // Key file exists with 0o600
      const keyPath = path.join(configDir, 'key.txt');
      expect(fs.existsSync(keyPath)).toBe(true);
      expect(fs.statSync(keyPath).mode & 0o777).toBe(KEY_FILE_PERMS);

      // Sync directory exists
      const syncDir = path.join(testHome, '.context-sync');
      expect(fs.existsSync(syncDir)).toBe(true);

      // Git repo initialized
      expect(fs.existsSync(path.join(syncDir, '.git'))).toBe(true);

      // Manifest exists
      const manifestPath = path.join(syncDir, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.version).toBe(VERSION);
    });
  });

  describe('Key file has correct permissions', () => {
    it('should set key file to 0o600', async () => {
      await executeInit({ noInteractive: true });

      const keyPath = path.join(testHome, '.config', 'ctx-sync', 'key.txt');
      const stats = fs.statSync(keyPath);
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it('should set config dir to 0o700', async () => {
      await executeInit({ noInteractive: true });

      const configDir = path.join(testHome, '.config', 'ctx-sync');
      const stats = fs.statSync(configDir);
      expect(stats.mode & 0o777).toBe(0o700);
    });
  });

  describe('Git repo is initialized with correct remote', () => {
    it('should initialize git repo in sync directory', async () => {
      await executeInit({ noInteractive: true });

      const syncDir = path.join(testHome, '.context-sync');
      expect(fs.existsSync(path.join(syncDir, '.git'))).toBe(true);
    });

    it('should have manifest.json committed', async () => {
      await executeInit({ noInteractive: true });

      const syncDir = path.join(testHome, '.context-sync');
      // Verify git log shows the initial commit
      const { execSync } = await import('node:child_process');
      const log = execSync('git log --oneline', {
        cwd: syncDir,
        encoding: 'utf-8',
      });
      expect(log).toContain('initialize context sync');
    });

    it('should push initial commit when remote is configured', async () => {
      const { execSync } = await import('node:child_process');

      // Create a bare repo to act as the remote
      const bareRepo = path.join(testHome, 'remote.git');
      fs.mkdirSync(bareRepo, { recursive: true });
      execSync('git init --bare', { cwd: bareRepo, encoding: 'utf-8' });

      // Init with the local bare repo as remote
      await executeInit({
        noInteractive: true,
        remote: bareRepo,
      });

      // Verify the bare repo received the commit
      const remoteLog = execSync('git log --oneline', {
        cwd: bareRepo,
        encoding: 'utf-8',
      });
      expect(remoteLog).toContain('initialize context sync');
    });
  });

  describe('Restore workflow', () => {
    it('should restore a key and create the correct structure', async () => {
      // Generate a key
      const { privateKey } = await generateKey();

      await executeRestore({
        noInteractive: true,
        key: privateKey,
      });

      // Config directory exists with correct permissions
      const configDir = path.join(testHome, '.config', 'ctx-sync');
      expect(fs.existsSync(configDir)).toBe(true);
      expect(fs.statSync(configDir).mode & 0o777).toBe(CONFIG_DIR_PERMS);

      // Key file exists with correct permissions
      const keyPath = path.join(configDir, 'key.txt');
      expect(fs.existsSync(keyPath)).toBe(true);
      expect(fs.statSync(keyPath).mode & 0o777).toBe(KEY_FILE_PERMS);

      // Saved key matches
      const savedKey = fs.readFileSync(keyPath, 'utf-8').trim();
      expect(savedKey).toBe(privateKey.trim());
    });

    it('should init → restore round-trip (same key works)', async () => {
      // Init on "machine A"
      await executeInit({ noInteractive: true });

      // Read the private key
      const keyPath = path.join(testHome, '.config', 'ctx-sync', 'key.txt');
      const privateKey = fs.readFileSync(keyPath, 'utf-8').trim();

      // Simulate "machine B" with a different home
      const testHomeB = path.join(globalThis.TEST_DIR, `init-integ-b-${Date.now()}`);
      fs.mkdirSync(testHomeB, { recursive: true });
      process.env['CTX_SYNC_HOME'] = testHomeB;

      await executeRestore({
        noInteractive: true,
        key: privateKey,
      });

      // Both should have the same key
      const keyPathB = path.join(testHomeB, '.config', 'ctx-sync', 'key.txt');
      const keyB = fs.readFileSync(keyPathB, 'utf-8').trim();
      expect(keyB).toBe(privateKey);

      // Cleanup machine B
      fs.rmSync(testHomeB, { recursive: true, force: true });
    });
  });
});
