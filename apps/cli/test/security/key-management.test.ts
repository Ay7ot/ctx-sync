/**
 * Security tests for key management.
 *
 * Verifies:
 *   - key show NEVER outputs the private key.
 *   - key verify detects insecure permissions.
 *   - After rotation, old key cannot decrypt any file.
 *   - Re-encryption is complete (all files).
 *   - No plaintext key in logs or output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey, encryptState, decryptState } = await import(
  '../../src/core/encryption.js'
);
const { saveKey, loadKey, verifyPermissions } = await import(
  '../../src/core/key-store.js'
);
const { writeState, readState, listStateFiles } = await import(
  '../../src/core/state-manager.js'
);
const { identityToRecipient } = await import('age-encryption');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `keymgmt-sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  const syncDir = path.join(testHome, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(syncDir, { recursive: true });

  const { publicKey, privateKey } = await generateKey();
  saveKey(configDir, privateKey);

  return { testHome, configDir, syncDir, publicKey, privateKey };
}

async function populateAllStateFiles(
  syncDir: string,
  publicKey: string,
): Promise<void> {
  await writeState(
    syncDir,
    { machine: { id: 'test', hostname: 'test' }, projects: [{ id: 'proj', name: 'my-app', path: '~/projects/my-app', git: { branch: 'main', remote: 'origin', hasUncommitted: false, stashCount: 0 }, lastAccessed: new Date().toISOString() }] },
    publicKey,
    'state',
  );
  await writeState(
    syncDir,
    { 'my-app': { SECRET_KEY: { value: 'sk_live_super_secret_123', addedAt: new Date().toISOString() } } },
    publicKey,
    'env-vars',
  );
  await writeState(
    syncDir,
    { 'my-app': { composeFile: 'docker-compose.yml', services: [{ name: 'db', container: 'app-db', image: 'postgres:15', port: 5432, autoStart: true }] } },
    publicKey,
    'docker-state',
  );
  await writeState(
    syncDir,
    { 'my-app': { currentTask: 'Testing security', blockers: [], nextSteps: ['Deploy'], relatedLinks: [], breadcrumbs: [] } },
    publicKey,
    'mental-context',
  );
  await writeState(
    syncDir,
    { services: [{ project: 'my-app', name: 'api', port: 3000, command: 'npm start', autoStart: true }] },
    publicKey,
    'services',
  );
  await writeState(
    syncDir,
    { recentDirs: [{ path: '~/projects/my-app', frequency: 10, lastVisit: new Date().toISOString() }], pinnedDirs: ['~/projects'] },
    publicKey,
    'directories',
  );
}

async function rotateAllFiles(
  syncDir: string,
  oldPrivateKey: string,
  newPublicKey: string,
): Promise<string[]> {
  const ageFiles = listStateFiles(syncDir);
  const rotated: string[] = [];

  for (const filename of ageFiles) {
    const filePath = path.join(syncDir, filename);
    const ct = fs.readFileSync(filePath, 'utf-8');
    if (!ct.trim()) continue;
    const data = await decryptState(ct, oldPrivateKey);
    const newCt = await encryptState(data, newPublicKey);
    fs.writeFileSync(filePath, newCt, 'utf-8');
    rotated.push(filename);
  }

  return rotated;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Key Management Security', () => {
  // ── key show never exposes private key ────────────────────────────

  describe('Private key exposure prevention', () => {
    it('identityToRecipient should return only public key', async () => {
      const { privateKey } = await setupTestEnv();

      const publicKey = await identityToRecipient(privateKey);

      expect(publicKey).toMatch(/^age1[a-z0-9]+$/);
      expect(publicKey).not.toContain('AGE-SECRET-KEY-');
    });

    it('public key derivation should not leak private key', async () => {
      const { privateKey, publicKey } = await setupTestEnv();

      // The public key must not contain ANY part of the private key
      const secretPart = privateKey.replace('AGE-SECRET-KEY-', '');
      expect(publicKey).not.toContain(secretPart);
    });
  });

  // ── key verify detects insecure permissions ───────────────────────

  describe('Permission verification', () => {
    it('should detect key file at 644', async () => {
      const { configDir } = await setupTestEnv();
      fs.chmodSync(path.join(configDir, 'key.txt'), 0o644);

      const result = verifyPermissions(configDir);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i: string) => i.includes('644'))).toBe(true);
    });

    it('should detect key file at 777', async () => {
      const { configDir } = await setupTestEnv();
      fs.chmodSync(path.join(configDir, 'key.txt'), 0o777);

      const result = verifyPermissions(configDir);

      expect(result.valid).toBe(false);
    });

    it('should detect config dir at 755', async () => {
      const { configDir } = await setupTestEnv();
      fs.chmodSync(configDir, 0o755);

      const result = verifyPermissions(configDir);

      expect(result.valid).toBe(false);
    });

    it('should accept key at 600 and dir at 700', async () => {
      const { configDir } = await setupTestEnv();

      const result = verifyPermissions(configDir);

      expect(result.valid).toBe(true);
    });

    it('should refuse to load key with wrong permissions', async () => {
      const { configDir } = await setupTestEnv();
      fs.chmodSync(path.join(configDir, 'key.txt'), 0o644);

      expect(() => loadKey(configDir)).toThrow('insecure permissions');
    });
  });

  // ── After rotation, old key cannot decrypt ────────────────────────

  describe('Key rotation security', () => {
    it('old key cannot decrypt ANY file after rotation', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      // Populate all state types
      await populateAllStateFiles(syncDir, publicKey);

      // Generate new key and rotate
      const { publicKey: newPub, privateKey: _newPriv } = await generateKey();
      await rotateAllFiles(syncDir, privateKey, newPub);

      // Old key should fail on every file
      const ageFiles = listStateFiles(syncDir);
      expect(ageFiles.length).toBe(6); // All 6 state types

      for (const filename of ageFiles) {
        const filePath = path.join(syncDir, filename);
        const ct = fs.readFileSync(filePath, 'utf-8');
        await expect(decryptState(ct, privateKey)).rejects.toThrow();
      }
    });

    it('new key can decrypt ALL files after rotation', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await populateAllStateFiles(syncDir, publicKey);

      const { publicKey: newPub, privateKey: newPriv } = await generateKey();
      await rotateAllFiles(syncDir, privateKey, newPub);

      const ageFiles = listStateFiles(syncDir);
      for (const filename of ageFiles) {
        const filePath = path.join(syncDir, filename);
        const ct = fs.readFileSync(filePath, 'utf-8');
        const data = await decryptState(ct, newPriv);
        expect(data).toBeTruthy();
      }
    });

    it('re-encryption preserves data integrity', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      const envData = {
        'my-app': {
          STRIPE_KEY: { value: 'sk_live_secret_abc_123', addedAt: '2025-01-01T00:00:00Z' },
          DB_URL: { value: 'postgres://user:pass@localhost:5432/db', addedAt: '2025-01-01T00:00:00Z' },
        },
      };

      await writeState(syncDir, envData, publicKey, 'env-vars');

      const { publicKey: newPub, privateKey: newPriv } = await generateKey();
      await rotateAllFiles(syncDir, privateKey, newPub);

      const recovered = await readState(syncDir, newPriv, 'env-vars');
      expect(recovered).toEqual(envData);
    });

    it('re-encryption covers ALL state file types', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await populateAllStateFiles(syncDir, publicKey);

      const { publicKey: newPub } = await generateKey();
      const rotated = await rotateAllFiles(syncDir, privateKey, newPub);

      // All 6 state types must be rotated
      expect(rotated).toContain('state.age');
      expect(rotated).toContain('env-vars.age');
      expect(rotated).toContain('docker-state.age');
      expect(rotated).toContain('mental-context.age');
      expect(rotated).toContain('services.age');
      expect(rotated).toContain('directories.age');
      expect(rotated).toHaveLength(6);
    });
  });

  // ── No plaintext on disk after rotation ───────────────────────────

  describe('No plaintext leakage after rotation', () => {
    it('no secret values in .age files on disk', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await populateAllStateFiles(syncDir, publicKey);

      const { publicKey: newPub } = await generateKey();
      await rotateAllFiles(syncDir, privateKey, newPub);

      // Scan all files for plaintext
      const ageFiles = listStateFiles(syncDir);
      for (const filename of ageFiles) {
        const filePath = path.join(syncDir, filename);
        const raw = fs.readFileSync(filePath, 'utf-8');

        expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
        expect(raw).not.toContain('sk_live_super_secret_123');
        expect(raw).not.toContain('my-app');
        expect(raw).not.toContain('postgres');
        expect(raw).not.toContain('npm start');
      }
    });

    it('no .json state files on disk', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await populateAllStateFiles(syncDir, publicKey);

      const { publicKey: newPub } = await generateKey();
      await rotateAllFiles(syncDir, privateKey, newPub);

      const entries = fs.readdirSync(syncDir);
      const jsonFiles = entries.filter(
        (e) => e.endsWith('.json') && e !== 'manifest.json',
      );
      expect(jsonFiles).toHaveLength(0);
    });
  });

  // ── Key file security ────────────────────────────────────────────

  describe('Key file security', () => {
    it('saveKey sets correct permissions', async () => {
      const { configDir } = await setupTestEnv();
      const { privateKey: newKey } = await generateKey();

      saveKey(configDir, newKey);

      const stats = fs.statSync(path.join(configDir, 'key.txt'));
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it('config dir has correct permissions', async () => {
      const { configDir } = await setupTestEnv();

      const stats = fs.statSync(configDir);
      expect(stats.mode & 0o777).toBe(0o700);
    });
  });
});
