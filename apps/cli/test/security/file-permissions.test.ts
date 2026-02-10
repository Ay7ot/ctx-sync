import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  saveKey,
  loadKey,
  KEY_FILE_PERMS,
  CONFIG_DIR_PERMS,
  KEY_FILE_NAME,
} from '../../src/core/key-store.js';

describe('Security: File Permissions', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = path.join(globalThis.TEST_DIR, 'security-perms-test');
  });

  it('should set key file permissions to exactly 0o600 after save', () => {
    saveKey(configDir, 'AGE-SECRET-KEY-SECURITY-TEST');

    const keyPath = path.join(configDir, KEY_FILE_NAME);
    const stats = fs.statSync(keyPath);
    const mode = stats.mode & 0o777;

    expect(mode).toBe(KEY_FILE_PERMS);
    expect(mode).toBe(0o600);
  });

  it('should set config directory permissions to exactly 0o700 after save', () => {
    saveKey(configDir, 'AGE-SECRET-KEY-SECURITY-TEST');

    const stats = fs.statSync(configDir);
    const mode = stats.mode & 0o777;

    expect(mode).toBe(CONFIG_DIR_PERMS);
    expect(mode).toBe(0o700);
  });

  it('should refuse to load key with permissions 0o644 (world-readable)', () => {
    saveKey(configDir, 'AGE-SECRET-KEY-SECURITY-TEST');
    const keyPath = path.join(configDir, KEY_FILE_NAME);
    fs.chmodSync(keyPath, 0o644);

    expect(() => loadKey(configDir)).toThrow('insecure permissions');
  });

  it('should refuse to load key with permissions 0o666 (world-writable)', () => {
    saveKey(configDir, 'AGE-SECRET-KEY-SECURITY-TEST');
    const keyPath = path.join(configDir, KEY_FILE_NAME);
    fs.chmodSync(keyPath, 0o666);

    expect(() => loadKey(configDir)).toThrow('insecure permissions');
  });

  it('should refuse to load key with permissions 0o755 (world-executable)', () => {
    saveKey(configDir, 'AGE-SECRET-KEY-SECURITY-TEST');
    const keyPath = path.join(configDir, KEY_FILE_NAME);
    fs.chmodSync(keyPath, 0o755);

    expect(() => loadKey(configDir)).toThrow('insecure permissions');
  });

  it('should refuse to load key with permissions 0o660 (group-readable)', () => {
    saveKey(configDir, 'AGE-SECRET-KEY-SECURITY-TEST');
    const keyPath = path.join(configDir, KEY_FILE_NAME);
    fs.chmodSync(keyPath, 0o660);

    expect(() => loadKey(configDir)).toThrow('insecure permissions');
  });

  it('should include a chmod fix suggestion in the error message', () => {
    saveKey(configDir, 'AGE-SECRET-KEY-SECURITY-TEST');
    const keyPath = path.join(configDir, KEY_FILE_NAME);
    fs.chmodSync(keyPath, 0o644);

    try {
      loadKey(configDir);
      fail('Expected loadKey to throw');
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toContain('chmod 600');
      expect(message).toContain(keyPath);
    }
  });

  it('should accept key with exactly 0o600 permissions', () => {
    const testKey = 'AGE-SECRET-KEY-1VALIDKEYFORTEST';
    saveKey(configDir, testKey);

    // Should not throw
    const loaded = loadKey(configDir);
    expect(loaded).toBe(testKey);
  });
});
