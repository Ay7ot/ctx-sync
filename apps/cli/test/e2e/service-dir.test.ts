/**
 * E2E tests for `ctx-sync service` and `ctx-sync dir` commands.
 *
 * Uses real CLI invocations via tsx to test service and directory
 * management end-to-end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync service', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('service');
    await env.setup();
    // Init ctx-sync
    env.execCommand('init --no-interactive');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  // ── service add + list ──────────────────────────────────────────────

  describe('service add + list', () => {
    it('should add a service and list it', () => {
      const addResult = env.execCommand(
        'service add my-proj api -p 3000 -c "npm start" --no-sync',
      );
      expect(addResult.exitCode).toBe(0);
      expect(addResult.stdout).toContain('api');
      expect(addResult.stdout).toContain('my-proj');

      const listResult = env.execCommand('service list my-proj');
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain('api');
      expect(listResult.stdout).toContain('3000');
    });

    it('should add an auto-start service', () => {
      env.execCommand(
        'service add proj api -p 3000 -c "npm start" -a --no-sync',
      );

      const listResult = env.execCommand('service list proj');
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain('auto-start');
    });

    it('should reject invalid port', () => {
      const result = env.execCommand(
        'service add proj api -p 0 -c "npm start" --no-sync',
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Port');
    });
  });

  // ── service remove ──────────────────────────────────────────────────

  describe('service remove', () => {
    it('should remove an existing service', () => {
      env.execCommand(
        'service add proj api -p 3000 -c "npm start" --no-sync',
      );

      const removeResult = env.execCommand(
        'service remove proj api --no-sync',
      );
      expect(removeResult.exitCode).toBe(0);
      expect(removeResult.stdout).toContain('removed');
    });

    it('should report when service not found', () => {
      const result = env.execCommand(
        'service remove proj missing --no-sync',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('not found');
    });
  });

  // ── service start ───────────────────────────────────────────────────

  describe('service start', () => {
    it('should show commands in non-interactive mode', () => {
      env.execCommand(
        'service add proj api -p 3000 -c "npm start" -a --no-sync',
      );

      const result = env.execCommand('service start proj --no-interactive');
      expect(result.exitCode).toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain('npm start');
    });

    it('should report no auto-start services', () => {
      env.execCommand(
        'service add proj api -p 3000 -c "npm start" --no-sync',
      );

      const result = env.execCommand('service start proj --no-interactive');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No auto-start');
    });
  });

  // ── services encrypted on disk ──────────────────────────────────────

  describe('encryption', () => {
    it('should store services encrypted', () => {
      env.execCommand(
        'service add proj api -p 3000 -c "npm start" --no-sync',
      );

      const filePath = path.join(env.syncDir, 'services.age');
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('npm start');
    });
  });
});

describe('E2E: ctx-sync dir', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('dir');
    await env.setup();
    // Init ctx-sync
    env.execCommand('init --no-interactive');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  // ── dir visit + list ────────────────────────────────────────────────

  describe('dir visit + list', () => {
    it('should record a visit and list it', () => {
      const testDir = path.join(env.homeDir, 'my-project');
      fs.mkdirSync(testDir, { recursive: true });

      const visitResult = env.execCommand(
        `dir visit "${testDir}" --no-sync`,
      );
      expect(visitResult.exitCode).toBe(0);
      expect(visitResult.stdout).toContain('Recorded visit');

      const listResult = env.execCommand('dir list');
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain('my-project');
    });
  });

  // ── dir pin + unpin ─────────────────────────────────────────────────

  describe('dir pin + unpin', () => {
    it('should pin and list pinned directory', () => {
      const testDir = path.join(env.homeDir, 'pinned-proj');
      fs.mkdirSync(testDir, { recursive: true });

      const pinResult = env.execCommand(
        `dir pin "${testDir}" --no-sync`,
      );
      expect(pinResult.exitCode).toBe(0);
      expect(pinResult.stdout).toContain('Pinned');

      const listResult = env.execCommand('dir list');
      expect(listResult.exitCode).toBe(0);
      expect(listResult.stdout).toContain('pinned-proj');
    });

    it('should unpin a directory', () => {
      const testDir = path.join(env.homeDir, 'unpin-proj');
      fs.mkdirSync(testDir, { recursive: true });

      env.execCommand(`dir pin "${testDir}" --no-sync`);
      const result = env.execCommand(`dir unpin "${testDir}" --no-sync`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Unpinned');
    });
  });

  // ── dir remove ──────────────────────────────────────────────────────

  describe('dir remove', () => {
    it('should remove a directory from recent list', () => {
      const testDir = path.join(env.homeDir, 'remove-proj');
      fs.mkdirSync(testDir, { recursive: true });

      env.execCommand(`dir visit "${testDir}" --no-sync`);
      const result = env.execCommand(`dir remove "${testDir}" --no-sync`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Removed');
    });
  });

  // ── directories encrypted on disk ───────────────────────────────────

  describe('encryption', () => {
    it('should store directories encrypted', () => {
      const testDir = path.join(env.homeDir, 'secret-dir');
      fs.mkdirSync(testDir, { recursive: true });

      env.execCommand(`dir visit "${testDir}" --no-sync`);

      const filePath = path.join(env.syncDir, 'directories.age');
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('secret-dir');
    });
  });

  // ── path traversal ──────────────────────────────────────────────────

  describe('path traversal prevention', () => {
    it('should reject /etc path', () => {
      const result = env.execCommand('dir visit /etc/passwd --no-sync');
      expect(result.exitCode).toBe(1);
    });
  });
});
