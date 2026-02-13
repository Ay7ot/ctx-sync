/**
 * Integration test: Key Rotation Workflow.
 *
 * Verifies the full key rotation cycle:
 *   init → add data → rotate → verify old key fails, new key works.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey, decryptState, encryptState } = await import(
  '../../src/core/encryption.js'
);
const { saveKey, loadKey } = await import('../../src/core/key-store.js');
const { writeState, readState, listStateFiles } = await import(
  '../../src/core/state-manager.js'
);
const { identityToRecipient } = await import('age-encryption');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `key-rotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  const syncDir = path.join(testHome, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(syncDir, { recursive: true });

  const { publicKey, privateKey } = await generateKey();
  saveKey(configDir, privateKey);

  return { testHome, configDir, syncDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Key Rotation Integration', () => {
  it('should re-encrypt all state files with new key', async () => {
    const { configDir, syncDir, publicKey, privateKey } = await setupTestEnv();

    // 1. Write initial state files
    await writeState(
      syncDir,
      { machine: { id: 'test', hostname: 'test' }, projects: [{ id: 'proj', name: 'my-app', path: '~/projects/my-app', git: { branch: 'main', remote: 'origin', hasUncommitted: false, stashCount: 0 }, lastAccessed: new Date().toISOString() }] },
      publicKey,
      'state',
    );
    await writeState(
      syncDir,
      { 'my-app': { STRIPE_KEY: { value: 'sk_test_123', addedAt: new Date().toISOString() } } },
      publicKey,
      'env-vars',
    );
    await writeState(
      syncDir,
      { 'my-app': { currentTask: 'Testing', blockers: [], nextSteps: [], relatedLinks: [], breadcrumbs: [] } },
      publicKey,
      'mental-context',
    );

    // 2. Verify old key can decrypt
    const stateOld = await readState(syncDir, privateKey, 'state');
    expect(stateOld).not.toBeNull();

    // 3. Generate new key and re-encrypt
    const { publicKey: newPublicKey, privateKey: newPrivateKey } =
      await generateKey();

    const ageFiles = listStateFiles(syncDir);
    expect(ageFiles.length).toBe(3);

    for (const filename of ageFiles) {
      const filePath = path.join(syncDir, filename);
      const ciphertext = fs.readFileSync(filePath, 'utf-8');
      const plainData = await decryptState(ciphertext, privateKey);
      const newCiphertext = await encryptState(plainData, newPublicKey);
      fs.writeFileSync(filePath, newCiphertext, 'utf-8');
    }

    // Save new key
    saveKey(configDir, newPrivateKey);

    // 4. Verify new key CAN decrypt
    const stateNew = await readState(syncDir, newPrivateKey, 'state');
    expect(stateNew).not.toBeNull();

    const envNew = await readState(syncDir, newPrivateKey, 'env-vars');
    expect(envNew).not.toBeNull();

    // 5. Verify old key CANNOT decrypt
    await expect(
      readState(syncDir, privateKey, 'state'),
    ).rejects.toThrow();

    await expect(
      readState(syncDir, privateKey, 'env-vars'),
    ).rejects.toThrow();
  });

  it('should preserve data integrity after rotation', async () => {
    const { syncDir, publicKey, privateKey } = await setupTestEnv();

    const originalEnv = {
      'my-app': {
        STRIPE_KEY: { value: 'sk_test_123', addedAt: '2025-01-01T00:00:00Z' },
        DB_URL: { value: 'postgres://localhost/db', addedAt: '2025-01-01T00:00:00Z' },
      },
    };

    await writeState(syncDir, originalEnv, publicKey, 'env-vars');

    // Rotate
    const { publicKey: newPub, privateKey: newPriv } = await generateKey();
    const ciphertext = fs.readFileSync(
      path.join(syncDir, 'env-vars.age'),
      'utf-8',
    );
    const plain = await decryptState(ciphertext, privateKey);
    const newCipher = await encryptState(plain, newPub);
    fs.writeFileSync(path.join(syncDir, 'env-vars.age'), newCipher, 'utf-8');

    // Verify data is intact
    const recovered = await readState(syncDir, newPriv, 'env-vars');
    expect(recovered).toEqual(originalEnv);
  });

  it('should handle multiple state file types during rotation', async () => {
    const { syncDir, publicKey, privateKey } = await setupTestEnv();

    // Write all state file types
    await writeState(
      syncDir,
      { machine: { id: 'test', hostname: 'test' }, projects: [] },
      publicKey,
      'state',
    );
    await writeState(
      syncDir,
      { 'test': { KEY: { value: 'val', addedAt: new Date().toISOString() } } },
      publicKey,
      'env-vars',
    );
    await writeState(
      syncDir,
      { 'test': { composeFile: 'docker-compose.yml', services: [] } },
      publicKey,
      'docker-state',
    );
    await writeState(
      syncDir,
      { 'test': { currentTask: 'Work', blockers: [], nextSteps: [], relatedLinks: [], breadcrumbs: [] } },
      publicKey,
      'mental-context',
    );
    await writeState(
      syncDir,
      { services: [] },
      publicKey,
      'services',
    );
    await writeState(
      syncDir,
      { recentDirs: [], pinnedDirs: [] },
      publicKey,
      'directories',
    );

    const ageFiles = listStateFiles(syncDir);
    expect(ageFiles.length).toBe(6);

    // Rotate all
    const { publicKey: newPub, privateKey: newPriv } = await generateKey();
    for (const filename of ageFiles) {
      const filePath = path.join(syncDir, filename);
      const ct = fs.readFileSync(filePath, 'utf-8');
      const data = await decryptState(ct, privateKey);
      const newCt = await encryptState(data, newPub);
      fs.writeFileSync(filePath, newCt, 'utf-8');
    }

    // All should decrypt with new key
    for (const filename of ageFiles) {
      const filePath = path.join(syncDir, filename);
      const ct = fs.readFileSync(filePath, 'utf-8');
      const data = await decryptState(ct, newPriv);
      expect(data).toBeTruthy();
    }

    // None should decrypt with old key
    for (const filename of ageFiles) {
      const filePath = path.join(syncDir, filename);
      const ct = fs.readFileSync(filePath, 'utf-8');
      await expect(decryptState(ct, privateKey)).rejects.toThrow();
    }
  });

  it('should save new key with correct permissions after rotation', async () => {
    const { configDir, syncDir, publicKey } = await setupTestEnv();

    await writeState(
      syncDir,
      { machine: { id: 'test', hostname: 'test' }, projects: [] },
      publicKey,
      'state',
    );

    const { privateKey: newKey } = await generateKey();
    saveKey(configDir, newKey);

    const keyPath = path.join(configDir, 'key.txt');
    const stats = fs.statSync(keyPath);
    expect(stats.mode & 0o777).toBe(0o600);

    const saved = loadKey(configDir);
    expect(saved).toBe(newKey);
  });

  it('should verify key file is loadable after rotation', async () => {
    const { configDir, syncDir, publicKey } = await setupTestEnv();

    // Write state
    await writeState(
      syncDir,
      { machine: { id: 'test', hostname: 'test' }, projects: [] },
      publicKey,
      'state',
    );

    // Rotate
    const { publicKey: newPub, privateKey: newPriv } = await generateKey();
    saveKey(configDir, newPriv);

    // Load and derive public key
    const loaded = loadKey(configDir);
    const derivedPub = await identityToRecipient(loaded);
    expect(derivedPub).toBe(newPub);
  });
});
