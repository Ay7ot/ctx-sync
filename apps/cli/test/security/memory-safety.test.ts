import { withSecret, withSecretSync, zeroOut } from '../../src/utils/secure-memory.js';

describe('Security: Memory Safety', () => {
  it('should zero out secret buffers after use with async withSecret', async () => {
    const secretValue = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQTEST';
    const secretBuffer = Buffer.from(secretValue);

    await withSecret(secretBuffer, async (buf) => {
      // Simulate using the secret
      expect(buf.toString('utf-8')).toBe(secretValue);
    });

    // Buffer must be zeroed after withSecret completes
    expect(secretBuffer.every((byte) => byte === 0)).toBe(true);
  });

  it('should zero out secret buffers after use with sync withSecretSync', () => {
    const secretValue = 'sk_live_verysecretstripekey123';
    const secretBuffer = Buffer.from(secretValue);

    withSecretSync(secretBuffer, (buf) => {
      expect(buf.toString('utf-8')).toBe(secretValue);
    });

    expect(secretBuffer.every((byte) => byte === 0)).toBe(true);
  });

  it('should zero buffer even when function throws (async)', async () => {
    const secretBuffer = Buffer.from('sensitive-data-that-must-not-leak');

    try {
      await withSecret(secretBuffer, () => {
        throw new Error('simulated error during crypto');
      });
    } catch {
      // Expected
    }

    expect(secretBuffer.every((byte) => byte === 0)).toBe(true);
  });

  it('should zero buffer even when function throws (sync)', () => {
    const secretBuffer = Buffer.from('sensitive-data-that-must-not-leak');

    try {
      withSecretSync(secretBuffer, () => {
        throw new Error('simulated error during crypto');
      });
    } catch {
      // Expected
    }

    expect(secretBuffer.every((byte) => byte === 0)).toBe(true);
  });

  it('should zero out Uint8Array with zeroOut', () => {
    const key = new Uint8Array([0x41, 0x47, 0x45, 0x2d, 0x53, 0x45, 0x43]);
    zeroOut(key);
    expect(key.every((byte) => byte === 0)).toBe(true);
  });

  it('should not leak buffer contents through error objects', async () => {
    const secretBuffer = Buffer.from('ghp_secretgithubtoken123456');

    try {
      await withSecret(secretBuffer, () => {
        throw new Error('Operation failed');
      });
    } catch (err: unknown) {
      const errorMessage = (err as Error).message;
      const errorStack = (err as Error).stack ?? '';

      // Error should not contain the secret
      expect(errorMessage).not.toContain('ghp_secretgithubtoken123456');
      expect(errorStack).not.toContain('ghp_secretgithubtoken123456');
    }

    expect(secretBuffer.every((byte) => byte === 0)).toBe(true);
  });
});
