import { generateKey, encrypt, decrypt, encryptState, decryptState } from '../../src/core/encryption.js';

describe('Encryption Module', () => {
  let publicKey: string;
  let privateKey: string;

  beforeAll(async () => {
    const keys = await generateKey();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
  });

  describe('generateKey()', () => {
    it('should generate a valid Age key pair with correct formats', async () => {
      const keys = await generateKey();
      expect(keys.publicKey).toMatch(/^age1[a-z0-9]+$/);
      expect(keys.privateKey).toContain('AGE-SECRET-KEY-');
    });

    it('should generate unique keys each time', async () => {
      const keys1 = await generateKey();
      const keys2 = await generateKey();
      expect(keys1.publicKey).not.toBe(keys2.publicKey);
      expect(keys1.privateKey).not.toBe(keys2.privateKey);
    });

    it('should return both publicKey and privateKey fields', async () => {
      const keys = await generateKey();
      expect(keys).toHaveProperty('publicKey');
      expect(keys).toHaveProperty('privateKey');
      expect(typeof keys.publicKey).toBe('string');
      expect(typeof keys.privateKey).toBe('string');
    });
  });

  describe('encrypt()', () => {
    it('should produce ciphertext containing the Age header', async () => {
      const encrypted = await encrypt('my-secret-value', publicKey);
      expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    });

    it('should not contain the plaintext in the ciphertext', async () => {
      const plaintext = 'my-secret-value';
      const encrypted = await encrypt(plaintext, publicKey);
      expect(encrypted).not.toContain(plaintext);
    });

    it('should produce different ciphertext for the same plaintext (non-deterministic)', async () => {
      const plaintext = 'my-secret-value';
      const encrypted1 = await encrypt(plaintext, publicKey);
      const encrypted2 = await encrypt(plaintext, publicKey);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should encrypt and decrypt an empty string correctly', async () => {
      const encrypted = await encrypt('', publicKey);
      expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      const decrypted = await decrypt(encrypted, privateKey);
      expect(decrypted).toBe('');
    });

    it('should round-trip special characters including emoji and unicode', async () => {
      const plaintext = 'password with 🔐 emoji & symbols!@#$%^&*() 日本語 é à ü';
      const encrypted = await encrypt(plaintext, publicKey);
      const decrypted = await decrypt(encrypted, privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should round-trip multi-line values', async () => {
      const plaintext = 'line1\nline2\nline3\n\ttabbed line';
      const encrypted = await encrypt(plaintext, publicKey);
      const decrypted = await decrypt(encrypted, privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw with an invalid public key', async () => {
      await expect(encrypt('test', 'invalid-key')).rejects.toThrow();
    });

    it('should handle very long plaintext', async () => {
      const plaintext = 'A'.repeat(100_000);
      const encrypted = await encrypt(plaintext, publicKey);
      const decrypted = await decrypt(encrypted, privateKey);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('decrypt()', () => {
    it('should decrypt encrypted text correctly', async () => {
      const plaintext = 'my-secret-value';
      const encrypted = await encrypt(plaintext, publicKey);
      const decrypted = await decrypt(encrypted, privateKey);
      expect(decrypted).toBe(plaintext);
    });

    it('should throw with wrong private key', async () => {
      const encrypted = await encrypt('my-secret-value', publicKey);
      const wrongKeys = await generateKey();
      await expect(decrypt(encrypted, wrongKeys.privateKey)).rejects.toThrow();
    });

    it('should throw with malformed ciphertext', async () => {
      await expect(decrypt('not-age-data', privateKey)).rejects.toThrow();
    });

    it('should throw with truncated ciphertext', async () => {
      const encrypted = await encrypt('test', publicKey);
      const truncated = encrypted.slice(0, Math.floor(encrypted.length / 2));
      await expect(decrypt(truncated, privateKey)).rejects.toThrow();
    });
  });

  describe('encryptState()', () => {
    it('should encrypt a JSON object so no key or value is visible', async () => {
      const state = {
        'my-app': {
          STRIPE_KEY: { value: 'sk_live_abc123' },
          DATABASE_URL: { value: 'postgres://user:pass@localhost/db' },
          NODE_ENV: { value: 'development' },
        },
      };

      const encrypted = await encryptState(state, publicKey);

      expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(encrypted).not.toContain('my-app');
      expect(encrypted).not.toContain('STRIPE_KEY');
      expect(encrypted).not.toContain('sk_live_abc123');
      expect(encrypted).not.toContain('DATABASE_URL');
      expect(encrypted).not.toContain('postgres://');
      expect(encrypted).not.toContain('NODE_ENV');
      expect(encrypted).not.toContain('development');
    });

    it('should not contain any JSON structure in the output', async () => {
      const state = { projects: [{ name: 'test', path: '~/projects/test' }] };
      const encrypted = await encryptState(state, publicKey);

      expect(encrypted).not.toContain('"projects"');
      expect(encrypted).not.toContain('"name"');
      expect(encrypted).not.toContain('"path"');
      expect(encrypted).not.toMatch(/"[a-zA-Z]+":\s/);
    });
  });

  describe('decryptState()', () => {
    it('should round-trip a state object correctly', async () => {
      const state = {
        'my-app': {
          STRIPE_KEY: { value: 'sk_live_abc123', addedAt: '2025-02-10T10:00:00Z' },
          NODE_ENV: { value: 'development', addedAt: '2025-02-10T10:00:00Z' },
        },
      };

      const encrypted = await encryptState(state, publicKey);
      const decrypted = await decryptState<typeof state>(encrypted, privateKey);
      expect(decrypted).toEqual(state);
    });

    it('should round-trip complex nested objects', async () => {
      const state = {
        machine: { id: 'laptop-1', hostname: 'dev-machine.local' },
        projects: [
          {
            id: 'proj-1',
            name: 'my-app',
            path: '~/projects/my-app',
            git: {
              branch: 'feature/payments',
              remote: 'origin',
              hasUncommitted: true,
              stashCount: 2,
            },
            lastAccessed: '2025-02-10T14:30:00Z',
          },
        ],
      };

      const encrypted = await encryptState(state, publicKey);
      const decrypted = await decryptState<typeof state>(encrypted, privateKey);
      expect(decrypted).toEqual(state);
    });

    it('should round-trip an empty object', async () => {
      const encrypted = await encryptState({}, publicKey);
      const decrypted = await decryptState<Record<string, never>>(encrypted, privateKey);
      expect(decrypted).toEqual({});
    });

    it('should round-trip arrays', async () => {
      const data = [1, 'two', { three: 3 }, [4, 5]];
      const encrypted = await encryptState(data, publicKey);
      const decrypted = await decryptState<typeof data>(encrypted, privateKey);
      expect(decrypted).toEqual(data);
    });

    it('should throw with wrong private key', async () => {
      const state = { secret: 'value' };
      const encrypted = await encryptState(state, publicKey);
      const wrongKeys = await generateKey();
      await expect(decryptState(encrypted, wrongKeys.privateKey)).rejects.toThrow();
    });
  });
});
