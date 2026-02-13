/**
 * Unit tests for the `ctx-sync team` command.
 *
 * Verifies:
 *   - executeTeamAdd adds a member and re-encrypts state.
 *   - executeTeamRemove removes a member and re-encrypts state.
 *   - executeTeamRevoke revokes by key and re-encrypts state.
 *   - executeTeamList returns the owner key and all members.
 */

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
    commit: jest
      .fn<() => Promise<{ commit: string }>>()
      .mockResolvedValue({ commit: 'abc123' }),
    status: jest
      .fn<() => Promise<{ files: Array<{ path: string }> }>>()
      .mockResolvedValue({ files: [{ path: 'state.age' }] }),
  }),
  default: jest.fn(),
}));

const { generateKey } = await import('../../src/core/encryption.js');
const { writeState, readState } = await import(
  '../../src/core/state-manager.js'
);
const { initRecipients } = await import(
  '../../src/core/recipients.js'
);
const {
  executeTeamAdd,
  executeTeamRemove,
  executeTeamRevoke,
  executeTeamList,
} = await import('../../src/commands/team.js');
// identityToRecipient used internally by team commands

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `team-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  const syncDir = path.join(testHome, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDir, 0o700);
  fs.mkdirSync(syncDir, { recursive: true });

  process.env['CTX_SYNC_HOME'] = testHome;

  const { publicKey, privateKey } = await generateKey();
  fs.writeFileSync(path.join(configDir, 'key.txt'), privateKey, {
    mode: 0o600,
  });

  // Initialise recipients
  initRecipients(configDir, publicKey);

  return { testHome, configDir, syncDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Team Command', () => {
  // ── executeTeamAdd ────────────────────────────────────────────────

  describe('executeTeamAdd()', () => {
    it('should add a team member', async () => {
      const { publicKey: _ownerKey } = await setupTestEnv();
      const bobKeys = await generateKey();

      const result = await executeTeamAdd({
        name: 'Bob',
        key: bobKeys.publicKey,
        noVerify: true,
      });

      expect(result.name).toBe('Bob');
      expect(result.publicKey).toBe(bobKeys.publicKey);
      expect(result.fingerprint).toBeDefined();
    });

    it('should re-encrypt existing state for new member', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      // Write some state with only owner key
      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const bobKeys = await generateKey();
      await executeTeamAdd({
        name: 'Bob',
        key: bobKeys.publicKey,
        noVerify: true,
      });

      // Both owner and Bob should be able to decrypt
      const ownerState = await readState(syncDir, privateKey, 'state');
      expect(ownerState).toBeDefined();

      const bobState = await readState(syncDir, bobKeys.privateKey, 'state');
      expect(bobState).toBeDefined();
    });

    it('should reject invalid key', async () => {
      await setupTestEnv();

      await expect(
        executeTeamAdd({ name: 'Bad', key: 'invalid', noVerify: true }),
      ).rejects.toThrow('Invalid Age public key format');
    });
  });

  // ── executeTeamRemove ─────────────────────────────────────────────

  describe('executeTeamRemove()', () => {
    it('should remove a team member', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      // Write state
      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const bobKeys = await generateKey();
      await executeTeamAdd({
        name: 'Bob',
        key: bobKeys.publicKey,
        noVerify: true,
      });

      const result = await executeTeamRemove('Bob');

      expect(result.name).toBe('Bob');
      expect(result.publicKey).toBe(bobKeys.publicKey);
      expect(result.filesReEncrypted.length).toBeGreaterThan(0);
    });

    it('should prevent removed member from decrypting', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const bobKeys = await generateKey();
      await executeTeamAdd({
        name: 'Bob',
        key: bobKeys.publicKey,
        noVerify: true,
      });

      // Bob can decrypt before removal
      const before = await readState(syncDir, bobKeys.privateKey, 'state');
      expect(before).toBeDefined();

      // Remove Bob
      await executeTeamRemove('Bob');

      // Bob can no longer decrypt
      await expect(
        readState(syncDir, bobKeys.privateKey, 'state'),
      ).rejects.toThrow();

      // Owner still can
      const ownerState = await readState(syncDir, privateKey, 'state');
      expect(ownerState).toBeDefined();
    });

    it('should throw if name not found', async () => {
      await setupTestEnv();
      await expect(executeTeamRemove('Unknown')).rejects.toThrow(
        'No team member found',
      );
    });
  });

  // ── executeTeamRevoke ─────────────────────────────────────────────

  describe('executeTeamRevoke()', () => {
    it('should revoke by public key', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const bobKeys = await generateKey();
      await executeTeamAdd({
        name: 'Bob',
        key: bobKeys.publicKey,
        noVerify: true,
      });

      const result = await executeTeamRevoke(bobKeys.publicKey);

      expect(result.name).toBe('Bob');
      expect(result.filesReEncrypted.length).toBeGreaterThan(0);
    });

    it('should prevent revoked key from decrypting', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const bobKeys = await generateKey();
      await executeTeamAdd({
        name: 'Bob',
        key: bobKeys.publicKey,
        noVerify: true,
      });

      await executeTeamRevoke(bobKeys.publicKey);

      // Revoked key cannot decrypt
      await expect(
        readState(syncDir, bobKeys.privateKey, 'state'),
      ).rejects.toThrow();

      // Owner still can
      const ownerState = await readState(syncDir, privateKey, 'state');
      expect(ownerState).toBeDefined();
    });
  });

  // ── executeTeamList ───────────────────────────────────────────────

  describe('executeTeamList()', () => {
    it('should return owner key and empty members', async () => {
      const { publicKey } = await setupTestEnv();

      const result = await executeTeamList();

      expect(result.ownerPublicKey).toBe(publicKey);
      expect(result.members).toEqual([]);
    });

    it('should list added members', async () => {
      await setupTestEnv();

      const bobKeys = await generateKey();
      await executeTeamAdd({
        name: 'Bob',
        key: bobKeys.publicKey,
        noVerify: true,
      });

      const result = await executeTeamList();

      expect(result.members).toHaveLength(1);
      expect(result.members[0]?.name).toBe('Bob');
      expect(result.members[0]?.publicKey).toBe(bobKeys.publicKey);
    });
  });
});
