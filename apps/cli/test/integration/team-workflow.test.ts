/**
 * Integration test: Team / Multi-Recipient Workflow.
 *
 * Verifies the full team workflow:
 *   init → add member → encrypt state → both decrypt → revoke → revoked fails.
 *
 * No mocks — uses real encryption and file system operations.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey, decryptState, encryptStateForRecipients } = await import(
  '../../src/core/encryption.js'
);
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
} = await import('../../src/core/recipients.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `team-integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  const syncDir = path.join(testHome, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(syncDir, { recursive: true });

  const { publicKey, privateKey } = await generateKey();
  saveKey(configDir, privateKey);

  return { testHome, configDir, syncDir, publicKey, privateKey };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Team Workflow Integration', () => {
  it('should encrypt state for multiple recipients', async () => {
    const { configDir, syncDir, publicKey, privateKey } = await setupTestEnv();
    initRecipients(configDir, publicKey);

    // Add Bob
    const bob = await generateKey();
    addRecipient(configDir, 'Bob', bob.publicKey);

    // Get all keys and write state encrypted for everyone
    const allKeys = getAllRecipientKeys(configDir, publicKey);
    expect(allKeys).toHaveLength(2);

    await writeState(
      syncDir,
      { machine: { id: 'test', hostname: 'laptop' }, projects: [] },
      allKeys,
      'state',
    );

    // Owner can decrypt
    const ownerData = await readState(syncDir, privateKey, 'state');
    expect(ownerData).toBeDefined();

    // Bob can decrypt
    const bobData = await readState(syncDir, bob.privateKey, 'state');
    expect(bobData).toBeDefined();
  });

  it('should complete full add → use → revoke cycle', async () => {
    const { configDir, syncDir, publicKey, privateKey } = await setupTestEnv();
    initRecipients(configDir, publicKey);

    // 1. Write initial state with owner only
    await writeState(
      syncDir,
      {
        'my-app': {
          STRIPE_KEY: { value: 'sk_live_secret', addedAt: new Date().toISOString() },
        },
      },
      publicKey,
      'env-vars',
    );

    // 2. Add Bob as team member
    const bob = await generateKey();
    addRecipient(configDir, 'Bob', bob.publicKey);

    // 3. Re-encrypt for all recipients
    const allKeys = getAllRecipientKeys(configDir, publicKey);
    const ageFiles = listStateFiles(syncDir);

    for (const filename of ageFiles) {
      const filePath = path.join(syncDir, filename);
      const ciphertext = fs.readFileSync(filePath, 'utf-8');
      if (!ciphertext.trim()) continue;

      const plainData = await decryptState<unknown>(ciphertext, privateKey);
      const newCiphertext = await encryptStateForRecipients(plainData, allKeys);
      fs.writeFileSync(filePath, newCiphertext, 'utf-8');
    }

    // 4. Bob can now decrypt
    const bobEnv = await readState(syncDir, bob.privateKey, 'env-vars');
    expect(bobEnv).toBeDefined();

    // 5. Revoke Bob
    removeRecipientByKey(configDir, bob.publicKey);

    // 6. Re-encrypt without Bob
    const remainingKeys = getAllRecipientKeys(configDir, publicKey);
    expect(remainingKeys).toHaveLength(1);

    const ageFilesAfter = listStateFiles(syncDir);
    for (const filename of ageFilesAfter) {
      const filePath = path.join(syncDir, filename);
      const ciphertext = fs.readFileSync(filePath, 'utf-8');
      if (!ciphertext.trim()) continue;

      const plainData = await decryptState<unknown>(ciphertext, privateKey);
      const newCiphertext = await encryptStateForRecipients(
        plainData,
        remainingKeys,
      );
      fs.writeFileSync(filePath, newCiphertext, 'utf-8');
    }

    // 7. Bob can NO longer decrypt
    await expect(
      readState(syncDir, bob.privateKey, 'env-vars'),
    ).rejects.toThrow();

    // 8. Owner still can
    const ownerEnv = await readState(syncDir, privateKey, 'env-vars');
    expect(ownerEnv).toBeDefined();
  });

  it('should encrypt ALL state file types for recipients', async () => {
    const { configDir, syncDir, publicKey } = await setupTestEnv();
    initRecipients(configDir, publicKey);

    const bob = await generateKey();
    addRecipient(configDir, 'Bob', bob.publicKey);
    const allKeys = getAllRecipientKeys(configDir, publicKey);

    // Write all state file types
    await writeState(
      syncDir,
      { machine: { id: 'test', hostname: 'test' }, projects: [] },
      allKeys,
      'state',
    );
    await writeState(
      syncDir,
      { 'test': { PORT: { value: '3000', addedAt: new Date().toISOString() } } },
      allKeys,
      'env-vars',
    );
    await writeState(
      syncDir,
      { 'test': { composeFile: 'docker-compose.yml', services: [] } },
      allKeys,
      'docker-state',
    );
    await writeState(
      syncDir,
      {
        'test': {
          currentTask: 'Testing',
          blockers: [],
          nextSteps: [],
          relatedLinks: [],
          breadcrumbs: [],
        },
      },
      allKeys,
      'mental-context',
    );
    await writeState(
      syncDir,
      { services: [] },
      allKeys,
      'services',
    );
    await writeState(
      syncDir,
      { recentDirs: [], pinnedDirs: [] },
      allKeys,
      'directories',
    );

    // Verify Bob can decrypt all 6 state files
    const state = await readState(syncDir, bob.privateKey, 'state');
    expect(state).toBeDefined();

    const envVars = await readState(syncDir, bob.privateKey, 'env-vars');
    expect(envVars).toBeDefined();

    const docker = await readState(syncDir, bob.privateKey, 'docker-state');
    expect(docker).toBeDefined();

    const mental = await readState(syncDir, bob.privateKey, 'mental-context');
    expect(mental).toBeDefined();

    const services = await readState(syncDir, bob.privateKey, 'services');
    expect(services).toBeDefined();

    const dirs = await readState(syncDir, bob.privateKey, 'directories');
    expect(dirs).toBeDefined();
  });

  it('should handle multiple team members added and removed', async () => {
    const { configDir, syncDir, publicKey, privateKey } = await setupTestEnv();
    initRecipients(configDir, publicKey);

    const bob = await generateKey();
    const alice = await generateKey();
    const carol = await generateKey();

    addRecipient(configDir, 'Bob', bob.publicKey);
    addRecipient(configDir, 'Alice', alice.publicKey);
    addRecipient(configDir, 'Carol', carol.publicKey);

    const allKeys = getAllRecipientKeys(configDir, publicKey);
    expect(allKeys).toHaveLength(4);

    await writeState(
      syncDir,
      { machine: { id: 'test', hostname: 'test' }, projects: [] },
      allKeys,
      'state',
    );

    // All can decrypt
    for (const key of [privateKey, bob.privateKey, alice.privateKey, carol.privateKey]) {
      const data = await readState(syncDir, key, 'state');
      expect(data).toBeDefined();
    }

    // Remove Alice
    removeRecipientByName(configDir, 'Alice');
    const keysAfter = getAllRecipientKeys(configDir, publicKey);
    expect(keysAfter).toHaveLength(3);

    // Re-encrypt
    const ciphertext = fs.readFileSync(
      path.join(syncDir, 'state.age'),
      'utf-8',
    );
    const plainData = await decryptState<unknown>(ciphertext, privateKey);
    const newCiphertext = await encryptStateForRecipients(plainData, keysAfter);
    fs.writeFileSync(path.join(syncDir, 'state.age'), newCiphertext, 'utf-8');

    // Alice cannot decrypt
    await expect(
      readState(syncDir, alice.privateKey, 'state'),
    ).rejects.toThrow();

    // Others still can
    for (const key of [privateKey, bob.privateKey, carol.privateKey]) {
      const data = await readState(syncDir, key, 'state');
      expect(data).toBeDefined();
    }
  });
});
