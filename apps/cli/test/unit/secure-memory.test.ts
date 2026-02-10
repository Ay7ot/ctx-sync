import { withSecret, withSecretSync, clearString, zeroOut } from '../../src/utils/secure-memory.js';

describe('Secure Memory Module', () => {
  describe('withSecret()', () => {
    it('should pass the original buffer content to the function', async () => {
      const secret = Buffer.from('my-secret-value');
      let received = '';

      await withSecret(secret, (buf) => {
        received = buf.toString('utf-8');
      });

      expect(received).toBe('my-secret-value');
    });

    it('should zero the buffer after the function completes', async () => {
      const secret = Buffer.from('my-secret-value');

      await withSecret(secret, () => {
        // use the secret
      });

      // Buffer should be all zeroes
      expect(secret.every((byte) => byte === 0)).toBe(true);
    });

    it('should zero the buffer even if the function throws', async () => {
      const secret = Buffer.from('my-secret-value');

      await expect(
        withSecret(secret, () => {
          throw new Error('intentional failure');
        }),
      ).rejects.toThrow('intentional failure');

      // Buffer should still be zeroed
      expect(secret.every((byte) => byte === 0)).toBe(true);
    });

    it('should return the value from the function', async () => {
      const secret = Buffer.from('hello');

      const result = await withSecret(secret, (buf) => {
        return buf.toString('utf-8').toUpperCase();
      });

      expect(result).toBe('HELLO');
    });

    it('should work with async functions', async () => {
      const secret = Buffer.from('async-secret');

      const result = await withSecret(secret, async (buf) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return buf.length;
      });

      expect(result).toBe(12);
      expect(secret.every((byte) => byte === 0)).toBe(true);
    });
  });

  describe('withSecretSync()', () => {
    it('should pass the original buffer content to the function', () => {
      const secret = Buffer.from('sync-secret');
      let received = '';

      withSecretSync(secret, (buf) => {
        received = buf.toString('utf-8');
      });

      expect(received).toBe('sync-secret');
    });

    it('should zero the buffer after the function completes', () => {
      const secret = Buffer.from('sync-secret');

      withSecretSync(secret, () => {
        // use the secret
      });

      expect(secret.every((byte) => byte === 0)).toBe(true);
    });

    it('should zero the buffer even if the function throws', () => {
      const secret = Buffer.from('sync-secret');

      expect(() =>
        withSecretSync(secret, () => {
          throw new Error('sync failure');
        }),
      ).toThrow('sync failure');

      expect(secret.every((byte) => byte === 0)).toBe(true);
    });

    it('should return the value from the function', () => {
      const secret = Buffer.from('data');

      const result = withSecretSync(secret, (buf) => buf.length);

      expect(result).toBe(4);
    });
  });

  describe('clearString()', () => {
    it('should return an empty string', () => {
      const result = clearString('some-secret');
      expect(result).toBe('');
    });

    it('should allow overwriting a variable reference', () => {
      let secret = 'my-secret';
      secret = clearString(secret);
      expect(secret).toBe('');
    });
  });

  describe('zeroOut()', () => {
    it('should zero a Uint8Array', () => {
      const arr = new Uint8Array([1, 2, 3, 4, 5]);
      zeroOut(arr);
      expect(arr.every((byte) => byte === 0)).toBe(true);
    });

    it('should handle an empty array', () => {
      const arr = new Uint8Array(0);
      zeroOut(arr);
      expect(arr.length).toBe(0);
    });

    it('should zero a large array', () => {
      const arr = new Uint8Array(10_000);
      arr.fill(0xff);
      zeroOut(arr);
      expect(arr.every((byte) => byte === 0)).toBe(true);
    });
  });
});
