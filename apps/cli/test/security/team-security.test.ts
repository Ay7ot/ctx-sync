/**
 * Security tests for team / multi-recipient encryption.
 *
 * Verifies:
 *   - After revocation, revoked key CANNOT decrypt ANY state file.
 *   - Re-encryption is complete (all files re-encrypted after revocation).
 *   - Recipients config is not in the sync directory (never synced).
 *   - Multi-recipient ciphertext does not contain plaintext.
 *   - Owner key is always preserved (cannot be removed).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const {
  generateKey,
  decryptState,
  encryptStateForRecipients,
} = await import('../../src/core/encryption.js');
const { saveKey } = await import('../../src/core/key-store.js');
const { writeState, readState, listStateFiles } = await import(
  '../../src/core/state-manager.js'
);
const {
  initRecipients,
  addRecipient,
  removeRecipientByName,
  removeRecipientByKey,
  getAllRecipientKeys,
  getRecipients,
  RECIPIENTS_FILE,
} = await import('../../src/core/recipients.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `team-sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  publicKeys: string[],
): Promise<void> {
  await writeState(
    syncDir,
    { machine: { id: 'test', hostname: 'test' }, projects: [] },
    publicKeys,
    'state',
  );
  await writeState(
    syncDir,
    {
      'my-app': {
        SECRET: { value: 'sk_live_supersecret', addedAt: new Date().toISOString() },
      },
    },
    publicKeys,
    'env-vars',
  );
  await writeState(
    syncDir,
    { 'my-app': { composeFile: 'docker-compose.yml', services: [] } },
    publicKeys,
    'docker-state',
  );
  await writeState(
    syncDir,
    {
      'my-app': {
        currentTask: 'Testing security',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      },
    },
    publicKeys,
    'mental-context',
  );
  await writeState(
    syncDir,
    { services: [] },
    publicKeys,
    'services',
  );
  await writeState(
    syncDir,
    { recentDirs: [], pinnedDirs: [] },
    publicKeys,
    'directories',
  );
}

async function reEncryptAll(
  syncDir: string,
  decryptKey: string,
  encryptForKeys: string[],
): Promise<string[]> {
  const ageFiles = listStateFiles(syncDir);
  const reEncrypted: string[] = [];

  for (const filename of ageFiles) {
    const filePath = path.join(syncDir, filename);
    const ciphertext = fs.readFileSync(filePath, 'utf-8');
    if (!ciphertext.trim()) continue;

    const plainData = await decryptState<unknown>(ciphertext, decryptKey);
    const newCiphertext = await encryptStateForRecipients(
      plainData,
      encryptForKeys,
    );
    fs.writeFileSync(filePath, newCiphertext, 'utf-8');
    reEncrypted.push(filename);
  }

  return reEncrypted;
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Team Security', () => {
  // ── Revocation completeness ───────────────────────────────────────

  describe('Revocation completeness', () => {
    it('revoked key cannot decrypt ANY state file', async () => {
      const { configDir, syncDir, publicKey, privateKey } =
        await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bob = await generateKey();
      addRecipient(configDir, 'Bob', bob.publicKey);

      // Populate all state files for both recipients
      const allKeys = getAllRecipientKeys(configDir, publicKey);
      await populateAllStateFiles(syncDir, allKeys);

      // Verify Bob can decrypt before revocation
      const beforeState = await readState(syncDir, bob.privateKey, 'state');
      expect(beforeState).toBeDefined();

      // Revoke Bob
      removeRecipientByKey(configDir, bob.publicKey);

      // Re-encrypt all without Bob
      const remainingKeys = getAllRecipientKeys(configDir, publicKey);
      const reEncrypted = await reEncryptAll(
        syncDir,
        privateKey,
        remainingKeys,
      );

      // ALL files should have been re-encrypted
      expect(reEncrypted.length).toBeGreaterThanOrEqual(6);

      // Revoked key cannot decrypt ANY file
      const stateFiles = listStateFiles(syncDir);
      for (const filename of stateFiles) {
        const filePath = path.join(syncDir, filename);
        const ciphertext = fs.readFileSync(filePath, 'utf-8');
        if (!ciphertext.trim()) continue;

        await expect(
          decryptState(ciphertext, bob.privateKey),
        ).rejects.toThrow();
      }
    });

    it('re-encryption is complete (all .age files)', async () => {
      const { configDir, syncDir, publicKey, privateKey } =
        await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bob = await generateKey();
      addRecipient(configDir, 'Bob', bob.publicKey);

      const allKeys = getAllRecipientKeys(configDir, publicKey);
      await populateAllStateFiles(syncDir, allKeys);

      removeRecipientByKey(configDir, bob.publicKey);
      const remainingKeys = getAllRecipientKeys(configDir, publicKey);
      const reEncrypted = await reEncryptAll(
        syncDir,
        privateKey,
        remainingKeys,
      );

      const allAgeFiles = listStateFiles(syncDir);
      expect(reEncrypted.sort()).toEqual(allAgeFiles.sort());
    });
  });

  // ── Recipients config location ────────────────────────────────────

  describe('Recipients config is local-only', () => {
    it('should store recipients in config dir, NOT sync dir', async () => {
      const { configDir, syncDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bob = await generateKey();
      addRecipient(configDir, 'Bob', bob.publicKey);

      // Recipients file should exist in config dir
      expect(
        fs.existsSync(path.join(configDir, RECIPIENTS_FILE)),
      ).toBe(true);

      // Recipients file should NOT exist in sync dir
      expect(
        fs.existsSync(path.join(syncDir, RECIPIENTS_FILE)),
      ).toBe(false);

      // No recipients.json in sync dir at all
      const syncFiles = fs.existsSync(syncDir)
        ? fs.readdirSync(syncDir)
        : [];
      expect(syncFiles).not.toContain(RECIPIENTS_FILE);
    });
  });

  // ── Plaintext exposure ────────────────────────────────────────────

  describe('No plaintext in multi-recipient ciphertext', () => {
    it('should not contain secrets in ciphertext', async () => {
      const { configDir, syncDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bob = await generateKey();
      addRecipient(configDir, 'Bob', bob.publicKey);
      const allKeys = getAllRecipientKeys(configDir, publicKey);

      await writeState(
        syncDir,
        {
          'my-app': {
            STRIPE_KEY: {
              value: 'sk_live_supersecret_abc123',
              addedAt: new Date().toISOString(),
            },
            DATABASE_URL: {
              value: 'postgres://user:pass@localhost:5432/db',
              addedAt: new Date().toISOString(),
            },
          },
        },
        allKeys,
        'env-vars',
      );

      const raw = fs.readFileSync(
        path.join(syncDir, 'env-vars.age'),
        'utf-8',
      );

      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('sk_live_supersecret_abc123');
      expect(raw).not.toContain('postgres://user:pass');
      expect(raw).not.toContain('STRIPE_KEY');
      expect(raw).not.toContain('DATABASE_URL');
    });

    it('should not contain project names or paths in ciphertext', async () => {
      const { configDir, syncDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bob = await generateKey();
      addRecipient(configDir, 'Bob', bob.publicKey);
      const allKeys = getAllRecipientKeys(configDir, publicKey);

      await writeState(
        syncDir,
        {
          machine: { id: 'my-machine', hostname: 'secret-hostname' },
          projects: [
            {
              id: 'proj1',
              name: 'secret-project',
              path: '~/private/project',
              git: {
                branch: 'main',
                remote: 'origin',
                hasUncommitted: false,
                stashCount: 0,
              },
              lastAccessed: new Date().toISOString(),
            },
          ],
        },
        allKeys,
        'state',
      );

      const raw = fs.readFileSync(
        path.join(syncDir, 'state.age'),
        'utf-8',
      );

      expect(raw).not.toContain('secret-project');
      expect(raw).not.toContain('secret-hostname');
      expect(raw).not.toContain('~/private/project');
    });
  });

  // ── Owner key protection ──────────────────────────────────────────

  describe('Owner key protection', () => {
    it('should reject adding own key as team member', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      expect(() =>
        addRecipient(configDir, 'Self', publicKey),
      ).toThrow('Cannot add your own key');
    });

    it('owner key should always remain after member removal', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bob = await generateKey();
      addRecipient(configDir, 'Bob', bob.publicKey);
      removeRecipientByName(configDir, 'Bob');

      const config = getRecipients(configDir);
      expect(config?.ownerPublicKey).toBe(publicKey);
      expect(config?.members).toHaveLength(0);
    });
  });
});
