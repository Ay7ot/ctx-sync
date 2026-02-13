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
    status: jest.fn<() => Promise<{ files: Array<{ path: string }> }>>().mockResolvedValue({ files: [{ path: 'directories.age' }] }),
  }),
  default: jest.fn(),
}));

const { generateKey } = await import('../../src/core/encryption.js');
const {
  visitDirectory,
  pinDirectory,
} = await import('../../src/core/directories-handler.js');
const {
  executeDirVisit,
  executeDirPin,
  executeDirUnpin,
  executeDirRemove,
  executeDirList,
} = await import('../../src/commands/dir.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `dir-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

/** Create a valid directory path inside the test home */
function validDir(testHome: string, name: string): string {
  const dirPath = path.join(testHome, name);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Dir Command', () => {
  // ── executeDirVisit() ───────────────────────────────────────────────

  describe('executeDirVisit()', () => {
    it('should record a directory visit', async () => {
      const { testHome } = await setupTestEnv();
      const dir = validDir(testHome, 'visit-test');

      const result = await executeDirVisit(dir, true);
      expect(result.path).toBe(dir);
    });

    it('should reject invalid paths', async () => {
      await setupTestEnv();

      await expect(executeDirVisit('/etc/shadow', true)).rejects.toThrow();
    });
  });

  // ── executeDirPin() / executeDirUnpin() ─────────────────────────────

  describe('executeDirPin() / executeDirUnpin()', () => {
    it('should pin and unpin a directory', async () => {
      const { testHome } = await setupTestEnv();
      const dir = validDir(testHome, 'pin-cmd-test');

      const pinResult = await executeDirPin(dir, true);
      expect(pinResult.alreadyPinned).toBe(false);

      const unpinResult = await executeDirUnpin(dir, true);
      expect(unpinResult.wasPinned).toBe(true);
    });

    it('should detect already-pinned', async () => {
      const { testHome } = await setupTestEnv();
      const dir = validDir(testHome, 'pin-dup-cmd');

      await executeDirPin(dir, true);
      const result = await executeDirPin(dir, true);
      expect(result.alreadyPinned).toBe(true);
    });
  });

  // ── executeDirRemove() ──────────────────────────────────────────────

  describe('executeDirRemove()', () => {
    it('should remove a visited directory', async () => {
      const { testHome } = await setupTestEnv();
      const dir = validDir(testHome, 'remove-cmd-test');

      await executeDirVisit(dir, true);
      const result = await executeDirRemove(dir, true);
      expect(result.wasRemoved).toBe(true);
    });

    it('should return false for unknown directory', async () => {
      const { testHome } = await setupTestEnv();
      const dir = validDir(testHome, 'remove-unknown');

      const result = await executeDirRemove(dir, true);
      expect(result.wasRemoved).toBe(false);
    });
  });

  // ── executeDirList() ────────────────────────────────────────────────

  describe('executeDirList()', () => {
    it('should return pinned and recent directories', async () => {
      const { testHome, syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir1 = validDir(testHome, 'list-pinned');
      const dir2 = validDir(testHome, 'list-recent');

      await pinDirectory(syncDir, dir1, publicKey, privateKey);
      await visitDirectory(syncDir, dir2, publicKey, privateKey);

      const result = await executeDirList(10);
      expect(result.pinned).toContain(dir1);
      expect(result.recent.some((d) => d.path === dir2)).toBe(true);
    });

    it('should return empty lists when no state', async () => {
      await setupTestEnv();

      const result = await executeDirList();
      expect(result.pinned).toEqual([]);
      expect(result.recent).toEqual([]);
    });
  });
});
