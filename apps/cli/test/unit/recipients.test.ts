/**
 * Unit tests for the recipients store module.
 *
 * Verifies:
 *   - computeFingerprint produces consistent hex output.
 *   - getRecipients / saveRecipients round-trip correctly.
 *   - initRecipients creates a valid config with owner key.
 *   - addRecipient validates keys, detects duplicates.
 *   - removeRecipientByName / removeRecipientByKey work correctly.
 *   - getAllRecipientKeys returns owner + members.
 *   - listRecipients returns current members.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey } = await import('../../src/core/encryption.js');
const {
  computeFingerprint,
  getRecipients,
  saveRecipients,
  initRecipients,
  addRecipient,
  removeRecipientByName,
  removeRecipientByKey,
  getAllRecipientKeys,
  listRecipients,
  RECIPIENTS_FILE,
} = await import('../../src/core/recipients.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `recipients-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

  process.env['CTX_SYNC_HOME'] = testHome;

  const { publicKey, privateKey } = await generateKey();
  fs.writeFileSync(path.join(configDir, 'key.txt'), privateKey, {
    mode: 0o600,
  });

  return { testHome, configDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Recipients Store', () => {
  // ── computeFingerprint ────────────────────────────────────────────

  describe('computeFingerprint()', () => {
    it('should produce a deterministic fingerprint', () => {
      const fp1 = computeFingerprint('age1testkey123');
      const fp2 = computeFingerprint('age1testkey123');
      expect(fp1).toBe(fp2);
    });

    it('should produce colon-separated uppercase hex pairs', () => {
      const fp = computeFingerprint('age1testkey123');
      // Format: XX:XX:XX:... (16 pairs = 32 hex chars)
      expect(fp).toMatch(/^[A-F0-9]{2}(:[A-F0-9]{2}){15}$/);
    });

    it('should produce different fingerprints for different keys', () => {
      const fp1 = computeFingerprint('age1key_one');
      const fp2 = computeFingerprint('age1key_two');
      expect(fp1).not.toBe(fp2);
    });
  });

  // ── getRecipients / saveRecipients ────────────────────────────────

  describe('getRecipients() / saveRecipients()', () => {
    it('should return null if no recipients file', async () => {
      const { configDir } = await setupTestEnv();
      const result = getRecipients(configDir);
      expect(result).toBeNull();
    });

    it('should round-trip recipients config', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      const config = {
        ownerPublicKey: publicKey,
        members: [],
      };

      saveRecipients(configDir, config);
      const loaded = getRecipients(configDir);

      expect(loaded).toEqual(config);
    });

    it('should return null for empty file', async () => {
      const { configDir } = await setupTestEnv();
      fs.writeFileSync(path.join(configDir, RECIPIENTS_FILE), '', 'utf-8');

      const result = getRecipients(configDir);
      expect(result).toBeNull();
    });
  });

  // ── initRecipients ────────────────────────────────────────────────

  describe('initRecipients()', () => {
    it('should create recipients config with owner key', async () => {
      const { configDir, publicKey } = await setupTestEnv();

      const config = initRecipients(configDir, publicKey);

      expect(config.ownerPublicKey).toBe(publicKey);
      expect(config.members).toEqual([]);
    });

    it('should not overwrite existing config', async () => {
      const { configDir, publicKey } = await setupTestEnv();

      initRecipients(configDir, publicKey);

      // Add a member manually
      const existing = getRecipients(configDir);
      existing!.members.push({
        name: 'Test',
        publicKey: 'age1test',
        addedAt: new Date().toISOString(),
        fingerprint: 'AA:BB',
      });
      saveRecipients(configDir, existing!);

      // initRecipients should NOT overwrite
      const result = initRecipients(configDir, publicKey);
      expect(result.members).toHaveLength(1);
    });

    it('should persist to disk', async () => {
      const { configDir, publicKey } = await setupTestEnv();

      initRecipients(configDir, publicKey);

      const filePath = path.join(configDir, RECIPIENTS_FILE);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  // ── addRecipient ──────────────────────────────────────────────────

  describe('addRecipient()', () => {
    it('should add a team member', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      const member = addRecipient(configDir, 'Bob', bobKey);

      expect(member.name).toBe('Bob');
      expect(member.publicKey).toBe(bobKey);
      expect(member.fingerprint).toMatch(/^[A-F0-9]{2}(:[A-F0-9]{2}){15}$/);
      expect(member.addedAt).toBeDefined();
    });

    it('should persist to disk', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);

      const config = getRecipients(configDir);
      expect(config?.members).toHaveLength(1);
      expect(config?.members[0]?.name).toBe('Bob');
    });

    it('should reject invalid key format', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      expect(() => addRecipient(configDir, 'Bob', 'invalid-key')).toThrow(
        'Invalid Age public key format',
      );
    });

    it('should reject duplicate key', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);

      expect(() => addRecipient(configDir, 'Bob2', bobKey)).toThrow(
        'already registered',
      );
    });

    it('should reject duplicate name', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);

      const otherKey = (await generateKey()).publicKey;
      expect(() => addRecipient(configDir, 'Bob', otherKey)).toThrow(
        'already exists',
      );
    });

    it('should reject own key', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      expect(() => addRecipient(configDir, 'Self', publicKey)).toThrow(
        'Cannot add your own key',
      );
    });

    it('should throw if not initialised', async () => {
      const { configDir } = await setupTestEnv();

      expect(() =>
        addRecipient(configDir, 'Bob', 'age1test'),
      ).toThrow('not initialised');
    });
  });

  // ── removeRecipientByName ─────────────────────────────────────────

  describe('removeRecipientByName()', () => {
    it('should remove by name', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);

      const removed = removeRecipientByName(configDir, 'Bob');
      expect(removed.name).toBe('Bob');
      expect(removed.publicKey).toBe(bobKey);

      const config = getRecipients(configDir);
      expect(config?.members).toHaveLength(0);
    });

    it('should be case-insensitive', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);

      const removed = removeRecipientByName(configDir, 'bob');
      expect(removed.name).toBe('Bob');
    });

    it('should throw if name not found', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      expect(() => removeRecipientByName(configDir, 'Unknown')).toThrow(
        'No team member found',
      );
    });
  });

  // ── removeRecipientByKey ──────────────────────────────────────────

  describe('removeRecipientByKey()', () => {
    it('should remove by public key', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);

      const removed = removeRecipientByKey(configDir, bobKey);
      expect(removed.name).toBe('Bob');

      const config = getRecipients(configDir);
      expect(config?.members).toHaveLength(0);
    });

    it('should throw if key not found', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      expect(() =>
        removeRecipientByKey(configDir, 'age1unknown'),
      ).toThrow('No team member found');
    });
  });

  // ── getAllRecipientKeys ───────────────────────────────────────────

  describe('getAllRecipientKeys()', () => {
    it('should return only owner key when no config', async () => {
      const { configDir, publicKey } = await setupTestEnv();

      const keys = getAllRecipientKeys(configDir, publicKey);
      expect(keys).toEqual([publicKey]);
    });

    it('should return owner + member keys', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);

      const keys = getAllRecipientKeys(configDir, publicKey);
      expect(keys).toHaveLength(2);
      expect(keys).toContain(publicKey);
      expect(keys).toContain(bobKey);
    });
  });

  // ── listRecipients ────────────────────────────────────────────────

  describe('listRecipients()', () => {
    it('should return empty array when no config', async () => {
      const { configDir } = await setupTestEnv();
      const members = listRecipients(configDir);
      expect(members).toEqual([]);
    });

    it('should return all members', async () => {
      const { configDir, publicKey } = await setupTestEnv();
      initRecipients(configDir, publicKey);

      const bobKey = (await generateKey()).publicKey;
      const aliceKey = (await generateKey()).publicKey;
      addRecipient(configDir, 'Bob', bobKey);
      addRecipient(configDir, 'Alice', aliceKey);

      const members = listRecipients(configDir);
      expect(members).toHaveLength(2);
      expect(members[0]?.name).toBe('Bob');
      expect(members[1]?.name).toBe('Alice');
    });
  });
});
