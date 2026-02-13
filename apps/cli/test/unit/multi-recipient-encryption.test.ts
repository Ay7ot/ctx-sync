/**
 * Unit tests for multi-recipient encryption.
 *
 * Verifies:
 *   - encryptForRecipients encrypts for multiple recipients.
 *   - Each recipient can independently decrypt.
 *   - An excluded key CANNOT decrypt.
 *   - Empty recipient list is rejected.
 *   - encryptStateForRecipients works with typed objects.
 */

// Ensure this file is treated as a module (required for declare global)
export {};

declare global {
  var TEST_DIR: string;
}

const {
  generateKey,
  decrypt,
  encryptForRecipients,
  encryptStateForRecipients,
  decryptState,
} = await import('../../src/core/encryption.js');

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Multi-Recipient Encryption', () => {
  // ── encryptForRecipients ──────────────────────────────────────────

  describe('encryptForRecipients()', () => {
    it('should encrypt for a single recipient', async () => {
      const alice = await generateKey();

      const ciphertext = await encryptForRecipients('secret', [
        alice.publicKey,
      ]);

      expect(ciphertext).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      const decrypted = await decrypt(ciphertext, alice.privateKey);
      expect(decrypted).toBe('secret');
    });

    it('should encrypt for two recipients', async () => {
      const alice = await generateKey();
      const bob = await generateKey();

      const ciphertext = await encryptForRecipients('shared-secret', [
        alice.publicKey,
        bob.publicKey,
      ]);

      // Both should decrypt
      const aliceResult = await decrypt(ciphertext, alice.privateKey);
      expect(aliceResult).toBe('shared-secret');

      const bobResult = await decrypt(ciphertext, bob.privateKey);
      expect(bobResult).toBe('shared-secret');
    });

    it('should encrypt for three or more recipients', async () => {
      const keys = await Promise.all([
        generateKey(),
        generateKey(),
        generateKey(),
      ]);

      const ciphertext = await encryptForRecipients(
        'multi-secret',
        keys.map((k) => k.publicKey),
      );

      // All should decrypt
      for (const key of keys) {
        const result = await decrypt(ciphertext, key.privateKey);
        expect(result).toBe('multi-secret');
      }
    });

    it('should not allow excluded key to decrypt', async () => {
      const alice = await generateKey();
      const bob = await generateKey();
      const carol = await generateKey();

      // Encrypt for alice and bob only
      const ciphertext = await encryptForRecipients('private', [
        alice.publicKey,
        bob.publicKey,
      ]);

      // Carol should NOT be able to decrypt
      await expect(
        decrypt(ciphertext, carol.privateKey),
      ).rejects.toThrow();
    });

    it('should reject empty recipient list', async () => {
      await expect(
        encryptForRecipients('test', []),
      ).rejects.toThrow('At least one recipient');
    });

    it('should produce different ciphertext each time', async () => {
      const alice = await generateKey();

      const ct1 = await encryptForRecipients('same', [alice.publicKey]);
      const ct2 = await encryptForRecipients('same', [alice.publicKey]);

      expect(ct1).not.toBe(ct2);
    });

    it('should handle special characters', async () => {
      const alice = await generateKey();
      const bob = await generateKey();

      const special = 'password with 🔐 emoji & symbols!@#$%^&*()_+';
      const ciphertext = await encryptForRecipients(special, [
        alice.publicKey,
        bob.publicKey,
      ]);

      const result = await decrypt(ciphertext, bob.privateKey);
      expect(result).toBe(special);
    });
  });

  // ── encryptStateForRecipients ─────────────────────────────────────

  describe('encryptStateForRecipients()', () => {
    it('should encrypt typed object for multiple recipients', async () => {
      const alice = await generateKey();
      const bob = await generateKey();

      const data = {
        machine: { id: 'test', hostname: 'laptop' },
        projects: [{ name: 'my-app', path: '~/projects/my-app' }],
      };

      const ciphertext = await encryptStateForRecipients(data, [
        alice.publicKey,
        bob.publicKey,
      ]);

      // Both should decrypt to the same typed data
      const aliceData = await decryptState(ciphertext, alice.privateKey);
      expect(aliceData).toEqual(data);

      const bobData = await decryptState(ciphertext, bob.privateKey);
      expect(bobData).toEqual(data);
    });

    it('should encrypt env vars for recipients', async () => {
      const alice = await generateKey();
      const bob = await generateKey();

      const envVars = {
        'my-app': {
          STRIPE_KEY: { value: 'sk_live_123', addedAt: new Date().toISOString() },
          PORT: { value: '3000', addedAt: new Date().toISOString() },
        },
      };

      const ciphertext = await encryptStateForRecipients(envVars, [
        alice.publicKey,
        bob.publicKey,
      ]);

      // Ciphertext should not contain plaintext secrets
      expect(ciphertext).not.toContain('sk_live_123');
      expect(ciphertext).not.toContain('3000');

      // Both should decrypt
      const aliceVars = await decryptState(ciphertext, alice.privateKey);
      expect(aliceVars).toEqual(envVars);
    });

    it('should reject empty recipients', async () => {
      const data = { test: 'value' };

      await expect(
        encryptStateForRecipients(data, []),
      ).rejects.toThrow('At least one recipient');
    });
  });
});
