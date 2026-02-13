import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey } = await import('../../src/core/encryption.js');
const {
  createService,
  addService,
  loadServices,
  removeService,
  removeProjectServices,
  getAutoStartServices,
} = await import('../../src/core/services-handler.js');
const {
  visitDirectory,
  pinDirectory,
  unpinDirectory,
  getTopDirectories,
  getPinnedDirectories,
  loadDirectories,
} = await import('../../src/core/directories-handler.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const syncDir = path.join(
    TEST_DIR,
    `integration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    '.context-sync',
  );
  fs.mkdirSync(syncDir, { recursive: true });
  const { publicKey, privateKey } = await generateKey();
  return { syncDir, publicKey, privateKey };
}

function validDir(name: string): string {
  const dirPath = path.join(TEST_DIR, `intg-${name}`);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Services & Directories Integration', () => {
  // ── Services full lifecycle ─────────────────────────────────────────

  describe('Services lifecycle', () => {
    it('should handle full add → load → remove lifecycle', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      // Add services
      const svc1 = createService('proj-a', 'api', 3000, 'npm start', true);
      const svc2 = createService('proj-a', 'worker', 4000, 'npm run worker', false);
      const svc3 = createService('proj-b', 'api', 5000, 'yarn dev', true);

      await addService(syncDir, svc1, publicKey, privateKey);
      await addService(syncDir, svc2, publicKey, privateKey);
      await addService(syncDir, svc3, publicKey, privateKey);

      // Verify state
      const loaded = await loadServices(syncDir, privateKey);
      expect(loaded.services).toHaveLength(3);

      // Auto-start filtering
      const autoStartA = await getAutoStartServices(syncDir, privateKey, 'proj-a');
      expect(autoStartA).toHaveLength(1);
      expect(autoStartA[0]!.name).toBe('api');

      // Remove single service
      const removed = await removeService(syncDir, 'proj-a', 'api', publicKey, privateKey);
      expect(removed).toBe(true);

      const afterRemove = await loadServices(syncDir, privateKey);
      expect(afterRemove.services).toHaveLength(2);

      // Remove all project services
      const projectRemoved = await removeProjectServices(
        syncDir,
        'proj-a',
        publicKey,
        privateKey,
      );
      expect(projectRemoved).toBe(1);

      const afterProjectRemove = await loadServices(syncDir, privateKey);
      expect(afterProjectRemove.services).toHaveLength(1);
      expect(afterProjectRemove.services[0]!.project).toBe('proj-b');
    });

    it('should encrypt services on disk (no plaintext)', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('my-secret-proj', 'my-api-server', 3000, 'npm run secret-command', true),
        publicKey,
        privateKey,
      );

      const filePath = path.join(syncDir, 'services.age');
      const raw = fs.readFileSync(filePath, 'utf-8');

      // No plaintext content
      expect(raw).not.toContain('my-secret-proj');
      expect(raw).not.toContain('my-api-server');
      expect(raw).not.toContain('secret-command');
      expect(raw).not.toContain('3000');

      // Is encrypted
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    });

    it('should fail to decrypt with wrong key', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );

      const wrongKey = (await generateKey()).privateKey;
      await expect(loadServices(syncDir, wrongKey)).rejects.toThrow();
    });
  });

  // ── Directories full lifecycle ──────────────────────────────────────

  describe('Directories lifecycle', () => {
    it('should handle full visit → pin → unpin lifecycle', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      const dir1 = validDir('lifecycle-a');
      const dir2 = validDir('lifecycle-b');
      const dir3 = validDir('lifecycle-c');

      // Visit directories with varying frequencies
      await visitDirectory(syncDir, dir1, publicKey, privateKey);
      await visitDirectory(syncDir, dir2, publicKey, privateKey);
      await visitDirectory(syncDir, dir2, publicKey, privateKey);
      await visitDirectory(syncDir, dir3, publicKey, privateKey);
      await visitDirectory(syncDir, dir3, publicKey, privateKey);
      await visitDirectory(syncDir, dir3, publicKey, privateKey);

      // Check top directories (sorted by frequency)
      const top = await getTopDirectories(syncDir, privateKey, 10);
      expect(top).toHaveLength(3);
      expect(top[0]!.path).toBe(dir3);
      expect(top[0]!.frequency).toBe(3);
      expect(top[1]!.path).toBe(dir2);
      expect(top[1]!.frequency).toBe(2);
      expect(top[2]!.path).toBe(dir1);
      expect(top[2]!.frequency).toBe(1);

      // Pin a directory
      await pinDirectory(syncDir, dir1, publicKey, privateKey);
      const pinned = await getPinnedDirectories(syncDir, privateKey);
      expect(pinned).toContain(dir1);

      // Unpin
      await unpinDirectory(syncDir, dir1, publicKey, privateKey);
      const afterUnpin = await getPinnedDirectories(syncDir, privateKey);
      expect(afterUnpin).not.toContain(dir1);
    });

    it('should encrypt directories on disk (no plaintext)', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      const secretDir = validDir('secret-project-dir');
      await visitDirectory(syncDir, secretDir, publicKey, privateKey);
      await pinDirectory(syncDir, secretDir, publicKey, privateKey);

      const filePath = path.join(syncDir, 'directories.age');
      const raw = fs.readFileSync(filePath, 'utf-8');

      expect(raw).not.toContain('secret-project-dir');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    });

    it('should fail to decrypt with wrong key', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      const dir = validDir('wrong-key-test');
      await visitDirectory(syncDir, dir, publicKey, privateKey);

      const wrongKey = (await generateKey()).privateKey;
      await expect(loadDirectories(syncDir, wrongKey)).rejects.toThrow();
    });
  });

  // ── Multi-state coexistence ─────────────────────────────────────────

  describe('Multi-state coexistence', () => {
    it('services and directories should coexist in same sync dir', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      // Save services
      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );

      // Save directories
      const dir = validDir('coexist-dir');
      await visitDirectory(syncDir, dir, publicKey, privateKey);

      // Both should be loadable independently
      const services = await loadServices(syncDir, privateKey);
      expect(services.services).toHaveLength(1);

      const directories = await loadDirectories(syncDir, privateKey);
      expect(directories.recentDirs).toHaveLength(1);

      // Both files should exist
      expect(fs.existsSync(path.join(syncDir, 'services.age'))).toBe(true);
      expect(fs.existsSync(path.join(syncDir, 'directories.age'))).toBe(true);
    });
  });
});
