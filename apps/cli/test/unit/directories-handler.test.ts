import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const {
  loadDirectories,
  saveDirectories,
  visitDirectory,
  pinDirectory,
  unpinDirectory,
  removeRecentDirectory,
  getTopDirectories,
  getPinnedDirectories,
  validateDirectoryPath,
  MAX_RECENT_DIRS,
} = await import('../../src/core/directories-handler.js');

const { generateKey } = await import('../../src/core/encryption.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const syncDir = path.join(
    TEST_DIR,
    `dirs-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    '.context-sync',
  );
  fs.mkdirSync(syncDir, { recursive: true });
  const { publicKey, privateKey } = await generateKey();
  return { syncDir, publicKey, privateKey };
}

/** Create a valid directory path inside TEST_DIR */
function validDir(name: string): string {
  const dirPath = path.join(TEST_DIR, name);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Directories Handler', () => {
  // ── loadDirectories / saveDirectories ───────────────────────────────

  describe('loadDirectories() / saveDirectories()', () => {
    it('should return empty state when no file exists', async () => {
      const { syncDir, privateKey } = await setupTestEnv();
      const state = await loadDirectories(syncDir, privateKey);
      expect(state).toEqual({ recentDirs: [], pinnedDirs: [] });
    });

    it('should save and load directories round-trip', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir1 = validDir('round-trip-a');
      const dir2 = validDir('round-trip-b');

      await saveDirectories(
        syncDir,
        {
          recentDirs: [
            { path: dir1, frequency: 5, lastVisit: '2026-01-01T00:00:00Z' },
            { path: dir2, frequency: 2, lastVisit: '2026-01-02T00:00:00Z' },
          ],
          pinnedDirs: [dir1],
        },
        publicKey,
      );

      const loaded = await loadDirectories(syncDir, privateKey);
      expect(loaded.recentDirs).toHaveLength(2);
      expect(loaded.pinnedDirs).toEqual([dir1]);
    });

    it('should encrypt on disk (no plaintext)', async () => {
      const { syncDir, publicKey } = await setupTestEnv();
      const dir1 = validDir('encrypt-test');

      await saveDirectories(
        syncDir,
        {
          recentDirs: [
            { path: dir1, frequency: 1, lastVisit: '2026-01-01T00:00:00Z' },
          ],
          pinnedDirs: [],
        },
        publicKey,
      );

      const filePath = path.join(syncDir, 'directories.age');
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).not.toContain('encrypt-test');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    });
  });

  // ── visitDirectory() ────────────────────────────────────────────────

  describe('visitDirectory()', () => {
    it('should add a new directory with frequency 1', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('visit-new');

      await visitDirectory(syncDir, dir, publicKey, privateKey);

      const state = await loadDirectories(syncDir, privateKey);
      expect(state.recentDirs).toHaveLength(1);
      expect(state.recentDirs[0]!.path).toBe(dir);
      expect(state.recentDirs[0]!.frequency).toBe(1);
    });

    it('should increment frequency on subsequent visits', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('visit-freq');

      await visitDirectory(syncDir, dir, publicKey, privateKey);
      await visitDirectory(syncDir, dir, publicKey, privateKey);
      await visitDirectory(syncDir, dir, publicKey, privateKey);

      const state = await loadDirectories(syncDir, privateKey);
      expect(state.recentDirs).toHaveLength(1);
      expect(state.recentDirs[0]!.frequency).toBe(3);
    });

    it('should update lastVisit on each visit', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('visit-time');

      await visitDirectory(syncDir, dir, publicKey, privateKey);
      const state1 = await loadDirectories(syncDir, privateKey);
      const firstVisit = state1.recentDirs[0]!.lastVisit;

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));
      await visitDirectory(syncDir, dir, publicKey, privateKey);
      const state2 = await loadDirectories(syncDir, privateKey);
      expect(state2.recentDirs[0]!.lastVisit >= firstVisit).toBe(true);
    });

    it('should prune to MAX_RECENT_DIRS', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      // Pre-build state with MAX_RECENT_DIRS + 5 entries (single write)
      const recentDirs = [];
      for (let i = 0; i < MAX_RECENT_DIRS + 5; i++) {
        const dir = validDir(`prune-${i}`);
        recentDirs.push({
          path: dir,
          frequency: 1,
          lastVisit: new Date(Date.now() - i * 1000).toISOString(),
        });
      }
      await saveDirectories(syncDir, { recentDirs, pinnedDirs: [] }, publicKey);

      // One more visit triggers pruning
      const extraDir = validDir('prune-extra');
      await visitDirectory(syncDir, extraDir, publicKey, privateKey);

      const state = await loadDirectories(syncDir, privateKey);
      expect(state.recentDirs.length).toBeLessThanOrEqual(MAX_RECENT_DIRS);
    });

    it('should reject path traversal', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await expect(
        visitDirectory(syncDir, '/etc/passwd', publicKey, privateKey),
      ).rejects.toThrow();
    });

    it('should reject empty path', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await expect(
        visitDirectory(syncDir, '', publicKey, privateKey),
      ).rejects.toThrow();
    });
  });

  // ── pinDirectory() / unpinDirectory() ───────────────────────────────

  describe('pinDirectory() / unpinDirectory()', () => {
    it('should pin a directory', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('pin-test');

      const pinned = await pinDirectory(syncDir, dir, publicKey, privateKey);
      expect(pinned).toBe(true);

      const state = await loadDirectories(syncDir, privateKey);
      expect(state.pinnedDirs).toContain(dir);
    });

    it('should return false if already pinned', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('pin-dup');

      await pinDirectory(syncDir, dir, publicKey, privateKey);
      const pinned = await pinDirectory(syncDir, dir, publicKey, privateKey);
      expect(pinned).toBe(false);
    });

    it('should unpin a directory', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('unpin-test');

      await pinDirectory(syncDir, dir, publicKey, privateKey);
      const unpinned = await unpinDirectory(syncDir, dir, publicKey, privateKey);
      expect(unpinned).toBe(true);

      const state = await loadDirectories(syncDir, privateKey);
      expect(state.pinnedDirs).not.toContain(dir);
    });

    it('should return false if not pinned', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('unpin-missing');

      const unpinned = await unpinDirectory(syncDir, dir, publicKey, privateKey);
      expect(unpinned).toBe(false);
    });

    it('should reject path traversal on pin', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await expect(
        pinDirectory(syncDir, '/etc/shadow', publicKey, privateKey),
      ).rejects.toThrow();
    });
  });

  // ── removeRecentDirectory() ─────────────────────────────────────────

  describe('removeRecentDirectory()', () => {
    it('should remove a recent directory', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('remove-recent');

      await visitDirectory(syncDir, dir, publicKey, privateKey);
      const removed = await removeRecentDirectory(
        syncDir,
        dir,
        publicKey,
        privateKey,
      );
      expect(removed).toBe(true);

      const state = await loadDirectories(syncDir, privateKey);
      expect(state.recentDirs).toHaveLength(0);
    });

    it('should return false if not found', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('remove-not-found');

      const removed = await removeRecentDirectory(
        syncDir,
        dir,
        publicKey,
        privateKey,
      );
      expect(removed).toBe(false);
    });
  });

  // ── getTopDirectories() ─────────────────────────────────────────────

  describe('getTopDirectories()', () => {
    it('should return directories sorted by frequency (descending)', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      const dirA = validDir('top-a');
      const dirB = validDir('top-b');

      // dirA visited 1x, dirB visited 3x
      await visitDirectory(syncDir, dirA, publicKey, privateKey);
      await visitDirectory(syncDir, dirB, publicKey, privateKey);
      await visitDirectory(syncDir, dirB, publicKey, privateKey);
      await visitDirectory(syncDir, dirB, publicKey, privateKey);

      const top = await getTopDirectories(syncDir, privateKey, 10);
      expect(top).toHaveLength(2);
      expect(top[0]!.path).toBe(dirB);
      expect(top[0]!.frequency).toBe(3);
      expect(top[1]!.path).toBe(dirA);
      expect(top[1]!.frequency).toBe(1);
    });

    it('should respect limit', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      for (let i = 0; i < 5; i++) {
        const dir = validDir(`limit-${i}`);
        await visitDirectory(syncDir, dir, publicKey, privateKey);
      }

      const top = await getTopDirectories(syncDir, privateKey, 3);
      expect(top).toHaveLength(3);
    });

    it('should return empty for no directories', async () => {
      const { syncDir, privateKey } = await setupTestEnv();
      const top = await getTopDirectories(syncDir, privateKey);
      expect(top).toEqual([]);
    });
  });

  // ── getPinnedDirectories() ──────────────────────────────────────────

  describe('getPinnedDirectories()', () => {
    it('should return all pinned directories', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir1 = validDir('pinned-1');
      const dir2 = validDir('pinned-2');

      await pinDirectory(syncDir, dir1, publicKey, privateKey);
      await pinDirectory(syncDir, dir2, publicKey, privateKey);

      const pinned = await getPinnedDirectories(syncDir, privateKey);
      expect(pinned).toHaveLength(2);
      expect(pinned).toContain(dir1);
      expect(pinned).toContain(dir2);
    });
  });

  // ── validateDirectoryPath() ─────────────────────────────────────────

  describe('validateDirectoryPath()', () => {
    it('should return the canonical path for a valid directory', () => {
      const dir = validDir('validate-ok');
      expect(validateDirectoryPath(dir)).toBe(dir);
    });

    it('should reject system paths', () => {
      expect(() => validateDirectoryPath('/etc/passwd')).toThrow();
    });

    it('should reject empty paths', () => {
      expect(() => validateDirectoryPath('')).toThrow();
    });
  });
});
