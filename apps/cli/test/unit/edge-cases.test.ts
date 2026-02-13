/**
 * Unit/integration tests for edge case hardening (Task 16.3).
 *
 * Covers all edge cases from the manual testing checklist in testing.md:
 *   - Empty .env file
 *   - Missing Git config
 *   - Corrupted encrypted state file
 *   - Tampered state file
 *   - Wrong encryption key
 *   - Binary data in .env
 *   - Very long env var values
 *   - Null bytes in input
 *   - Projects without Git
 *   - Projects without .env
 *   - Permission errors on key file
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

declare global {
  var TEST_DIR: string;
}

/** Create a unique temp directory isolated from the global TEST_DIR. */
function makeTempDir(prefix: string): string {
  const dir = path.join(os.tmpdir(), 'ctx-sync-edge', `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const { parseEnvFile } = await import('../../src/core/env-handler.js');
const { generateKey, encryptState, decryptState } = await import('../../src/core/encryption.js');
const { saveKey, loadKey } = await import('../../src/core/key-store.js');
const { readState, writeState } = await import('../../src/core/state-manager.js');
const { classifyError, EncryptionError, SecurityError, ConfigError, EdgeCaseError } =
  await import('../../src/utils/errors.js');

describe('Edge Cases: .env file parsing', () => {
  it('should handle empty .env file', () => {
    const result = parseEnvFile('');
    expect(result).toEqual([]);
  });

  it('should handle .env with only comments', () => {
    const result = parseEnvFile('# This is a comment\n# Another comment\n');
    expect(result).toEqual([]);
  });

  it('should handle .env with only whitespace', () => {
    const result = parseEnvFile('   \n\n   \n');
    expect(result).toEqual([]);
  });

  it('should handle binary data in .env without crashing', () => {
    // Binary data mixed with valid lines
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('utf-8');
    const content = `${binary}\nVALID_KEY=valid_value\n`;
    const result = parseEnvFile(content);

    // Should at least parse the valid line
    const validEntry = result.find((r) => r.key === 'VALID_KEY');
    expect(validEntry).toBeDefined();
    expect(validEntry?.value).toBe('valid_value');
  });

  it('should handle null bytes in .env', () => {
    const content = 'KEY1=val\x00ue\nKEY2=normal';
    const result = parseEnvFile(content);

    // Null bytes should be stripped
    const key1 = result.find((r) => r.key === 'KEY1');
    expect(key1).toBeDefined();
    expect(key1?.value).not.toContain('\x00');

    const key2 = result.find((r) => r.key === 'KEY2');
    expect(key2?.value).toBe('normal');
  });

  it('should handle very long env var values', () => {
    const longValue = 'A'.repeat(2_000_000); // 2MB value
    const content = `LONG_KEY=${longValue}`;
    const result = parseEnvFile(content);

    expect(result).toHaveLength(1);
    const entry = result[0];
    expect(entry?.key).toBe('LONG_KEY');
    // Should be truncated to 1MB max
    expect(entry?.value.length).toBeLessThanOrEqual(1_048_576);
  });

  it('should handle lines with = but no key', () => {
    const result = parseEnvFile('=value\n');
    expect(result).toEqual([]);
  });

  it('should handle lines with key but no value', () => {
    const result = parseEnvFile('KEY=\n');
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe('');
  });

  it('should handle Windows line endings', () => {
    const result = parseEnvFile('KEY1=val1\r\nKEY2=val2\r\n');
    expect(result).toHaveLength(2);
  });

  it('should handle export prefix', () => {
    const result = parseEnvFile('export KEY=value');
    expect(result).toHaveLength(1);
    expect(result[0]?.key).toBe('KEY');
    expect(result[0]?.value).toBe('value');
  });

  it('should handle duplicate keys (last wins)', () => {
    const result = parseEnvFile('KEY=first\nKEY=second\n');
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBe('second');
  });

  it('should strip surrounding quotes', () => {
    const result = parseEnvFile('K1="quoted"\nK2=\'single\'\n');
    expect(result[0]?.value).toBe('quoted');
    expect(result[1]?.value).toBe('single');
  });
});

describe('Edge Cases: Corrupted state files', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTempDir('edge-state');
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should handle corrupted state.age gracefully', async () => {
    fs.writeFileSync(path.join(testDir, 'state.age'), 'NOT_VALID_AGE_DATA');

    const keys = await generateKey();
    await expect(
      readState(testDir, keys.privateKey, 'state'),
    ).rejects.toThrow();
  });

  it('should handle tampered state.age (modified ciphertext)', async () => {
    const keys = await generateKey();
    const state = { machine: { id: 'test', hostname: 'test' }, projects: [] };
    await writeState(testDir, state, keys.publicKey, 'state');

    // Tamper with the file
    const content = fs.readFileSync(path.join(testDir, 'state.age'), 'utf-8');
    fs.writeFileSync(path.join(testDir, 'state.age'), content + 'TAMPERED');

    await expect(
      readState(testDir, keys.privateKey, 'state'),
    ).rejects.toThrow();
  });

  it('should fail when decrypting with wrong key', async () => {
    const keys1 = await generateKey();
    const keys2 = await generateKey();

    const state = { machine: { id: 'test', hostname: 'test' }, projects: [] };
    await writeState(testDir, state, keys1.publicKey, 'state');

    await expect(
      readState(testDir, keys2.privateKey, 'state'),
    ).rejects.toThrow();
  });

  it('should handle empty state.age file', async () => {
    fs.writeFileSync(path.join(testDir, 'state.age'), '');

    const keys = await generateKey();
    const result = await readState(testDir, keys.privateKey, 'state');
    expect(result).toBeNull();
  });

  it('should handle state.age with only whitespace', async () => {
    fs.writeFileSync(path.join(testDir, 'state.age'), '   \n\n   ');

    const keys = await generateKey();
    const result = await readState(testDir, keys.privateKey, 'state');
    expect(result).toBeNull();
  });

  it('should handle missing state.age file', async () => {
    const keys = await generateKey();
    const result = await readState(testDir, keys.privateKey, 'state');
    expect(result).toBeNull();
  });
});

describe('Edge Cases: Key file permissions', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTempDir('edge-key');
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should reject key file with insecure permissions', () => {
    const keyPath = path.join(testDir, 'key.txt');
    fs.writeFileSync(keyPath, 'AGE-SECRET-KEY-TEST');
    fs.chmodSync(keyPath, 0o644);

    expect(() => loadKey(testDir)).toThrow('insecure permissions');
  });

  it('should reject missing key file with helpful message', () => {
    expect(() => loadKey(testDir)).toThrow('Key file not found');
    expect(() => loadKey(testDir)).toThrow('ctx-sync init');
  });

  it('should load key with correct permissions', () => {
    saveKey(testDir, 'AGE-SECRET-KEY-TESTVALUE');
    const key = loadKey(testDir);
    expect(key).toBe('AGE-SECRET-KEY-TESTVALUE');
  });

  it('should set correct permissions on save', () => {
    saveKey(testDir, 'AGE-SECRET-KEY-TESTVALUE');

    const keyPath = path.join(testDir, 'key.txt');
    const stats = fs.statSync(keyPath);
    expect(stats.mode & 0o777).toBe(0o600);

    const dirStats = fs.statSync(testDir);
    expect(dirStats.mode & 0o777).toBe(0o700);
  });
});

describe('Edge Cases: Projects without Git', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTempDir('edge-nogit');
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('should detect project without Git gracefully', async () => {
    const { detectGitInfo } = await import('../../src/commands/track.js');
    const gitInfo = await detectGitInfo(testDir);

    expect(gitInfo.branch).toBe('unknown');
    expect(gitInfo.remote).toBe('');
    expect(gitInfo.hasUncommitted).toBe(false);
    expect(gitInfo.stashCount).toBe(0);
  });
});

describe('Edge Cases: Error classification', () => {
  it('should classify permission denied as SecurityError', () => {
    const err = classifyError(new Error('EACCES: permission denied'));
    expect(err).toBeInstanceOf(SecurityError);
  });

  it('should classify disk full as EdgeCaseError', () => {
    const err = classifyError(new Error('ENOSPC: no space left on device'));
    expect(err).toBeInstanceOf(EdgeCaseError);
  });

  it('should classify missing key as ConfigError', () => {
    const err = classifyError(new Error('ENOENT: no such file or directory, key.txt'));
    expect(err).toBeInstanceOf(ConfigError);
  });

  it('should classify decryption failure as EncryptionError', () => {
    const err = classifyError(new Error('Failed to decrypt: invalid age ciphertext'));
    expect(err).toBeInstanceOf(EncryptionError);
  });
});

describe('Edge Cases: Encryption round-trip with special data', () => {
  it('should encrypt and decrypt empty object', async () => {
    const keys = await generateKey();
    const data = {};
    const encrypted = await encryptState(data, keys.publicKey);
    const decrypted = await decryptState(encrypted, keys.privateKey);
    expect(decrypted).toEqual(data);
  });

  it('should encrypt and decrypt data with special characters', async () => {
    const keys = await generateKey();
    const data = {
      project: {
        name: 'app with 🔐 emoji & symbols!@#$%',
        path: '/path/with spaces/and\ttabs',
      },
    };
    const encrypted = await encryptState(data, keys.publicKey);
    const decrypted = await decryptState(encrypted, keys.privateKey);
    expect(decrypted).toEqual(data);
  });

  it('should encrypt and decrypt data with unicode', async () => {
    const keys = await generateKey();
    const data = { value: '日本語テスト 中文测试 한국어테스트' };
    const encrypted = await encryptState(data, keys.publicKey);
    const decrypted = await decryptState(encrypted, keys.privateKey);
    expect(decrypted).toEqual(data);
  });

  it('should encrypt and decrypt nested data', async () => {
    const keys = await generateKey();
    const data = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
            array: [1, 2, 3],
          },
        },
      },
    };
    const encrypted = await encryptState(data, keys.publicKey);
    const decrypted = await decryptState(encrypted, keys.privateKey);
    expect(decrypted).toEqual(data);
  });
});
