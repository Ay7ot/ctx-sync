import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  saveKey,
  loadKey,
  verifyPermissions,
  KEY_FILE_PERMS,
  CONFIG_DIR_PERMS,
  KEY_FILE_NAME,
} from '../../src/core/key-store.js';

describe('Key Store Module', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = path.join(globalThis.TEST_DIR, 'config-ctx-sync');
  });

  describe('saveKey()', () => {
    it('should create the config directory with 0o700 permissions', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');

      const stats = fs.statSync(configDir);
      expect(stats.mode & 0o777).toBe(CONFIG_DIR_PERMS);
    });

    it('should write the key file with 0o600 permissions', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');

      const keyPath = path.join(configDir, KEY_FILE_NAME);
      const stats = fs.statSync(keyPath);
      expect(stats.mode & 0o777).toBe(KEY_FILE_PERMS);
    });

    it('should write the correct key content', () => {
      const testKey = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQTEST';
      saveKey(configDir, testKey);

      const keyPath = path.join(configDir, KEY_FILE_NAME);
      const content = fs.readFileSync(keyPath, 'utf-8');
      expect(content).toBe(testKey);
    });

    it('should fix directory permissions if directory already exists with wrong perms', () => {
      // Create dir with insecure perms first
      fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });
      expect(fs.statSync(configDir).mode & 0o777).toBe(0o755);

      // saveKey should fix the permissions
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');
      expect(fs.statSync(configDir).mode & 0o777).toBe(CONFIG_DIR_PERMS);
    });

    it('should overwrite an existing key file', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-OLD');
      saveKey(configDir, 'AGE-SECRET-KEY-NEW');

      const keyPath = path.join(configDir, KEY_FILE_NAME);
      const content = fs.readFileSync(keyPath, 'utf-8');
      expect(content).toBe('AGE-SECRET-KEY-NEW');
    });
  });

  describe('loadKey()', () => {
    it('should return the correct key content', () => {
      const testKey = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQTEST';
      saveKey(configDir, testKey);

      const loaded = loadKey(configDir);
      expect(loaded).toBe(testKey);
    });

    it('should trim whitespace from the key', () => {
      const testKey = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQTEST';
      // Manually write with trailing newline
      fs.mkdirSync(configDir, { recursive: true, mode: CONFIG_DIR_PERMS });
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.writeFileSync(keyPath, testKey + '\n', { mode: KEY_FILE_PERMS });

      const loaded = loadKey(configDir);
      expect(loaded).toBe(testKey);
    });

    it('should throw if the key file does not exist', () => {
      expect(() => loadKey(configDir)).toThrow('Key file not found');
    });

    it('should throw with helpful message when key file is missing', () => {
      expect(() => loadKey(configDir)).toThrow('ctx-sync init');
    });

    it('should throw if the key file has insecure permissions (0o644)', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.chmodSync(keyPath, 0o644);

      expect(() => loadKey(configDir)).toThrow('insecure permissions');
    });

    it('should throw with the actual permissions in the error message', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.chmodSync(keyPath, 0o644);

      expect(() => loadKey(configDir)).toThrow('644');
    });

    it('should throw with chmod fix suggestion', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.chmodSync(keyPath, 0o644);

      expect(() => loadKey(configDir)).toThrow('chmod 600');
    });

    it('should throw if key file has invalid format (not AGE-SECRET-KEY- prefix)', () => {
      fs.mkdirSync(configDir, { recursive: true, mode: CONFIG_DIR_PERMS });
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.writeFileSync(keyPath, 'not-a-valid-key', { mode: KEY_FILE_PERMS });

      expect(() => loadKey(configDir)).toThrow('Invalid key format');
    });

    it('should throw with init --restore suggestion for invalid key format', () => {
      fs.mkdirSync(configDir, { recursive: true, mode: CONFIG_DIR_PERMS });
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.writeFileSync(keyPath, 'some-garbage-data', { mode: KEY_FILE_PERMS });

      expect(() => loadKey(configDir)).toThrow('ctx-sync init --restore');
    });

    it('should accept a valid AGE-SECRET-KEY format', () => {
      const validKey = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQTEST';
      saveKey(configDir, validKey);

      expect(loadKey(configDir)).toBe(validKey);
    });

    it('should reject permissions 0o666', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.chmodSync(keyPath, 0o666);

      expect(() => loadKey(configDir)).toThrow('insecure permissions');
    });

    it('should reject permissions 0o755', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.chmodSync(keyPath, 0o755);

      expect(() => loadKey(configDir)).toThrow('insecure permissions');
    });
  });

  describe('verifyPermissions()', () => {
    it('should return valid when everything is correct', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');

      const result = verifyPermissions(configDir);
      expect(result.valid).toBe(true);
      expect(result.keyFileExists).toBe(true);
      expect(result.keyFilePerms).toBe(KEY_FILE_PERMS);
      expect(result.configDirPerms).toBe(CONFIG_DIR_PERMS);
      expect(result.issues).toHaveLength(0);
    });

    it('should report missing config directory', () => {
      const result = verifyPermissions('/nonexistent/path');
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.includes('does not exist'))).toBe(true);
    });

    it('should report wrong config directory permissions', () => {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o755 });
      // Create key file so that's not also reported
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.writeFileSync(keyPath, 'test', { mode: KEY_FILE_PERMS });

      const result = verifyPermissions(configDir);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('755'))).toBe(true);
    });

    it('should report missing key file', () => {
      fs.mkdirSync(configDir, { recursive: true, mode: CONFIG_DIR_PERMS });

      const result = verifyPermissions(configDir);
      expect(result.valid).toBe(false);
      expect(result.keyFileExists).toBe(false);
      expect(result.issues.some((i) => i.includes('Key file not found'))).toBe(true);
    });

    it('should report wrong key file permissions', () => {
      saveKey(configDir, 'AGE-SECRET-KEY-TEST');
      const keyPath = path.join(configDir, KEY_FILE_NAME);
      fs.chmodSync(keyPath, 0o644);

      const result = verifyPermissions(configDir);
      expect(result.valid).toBe(false);
      expect(result.keyFilePerms).toBe(0o644);
      expect(result.issues.some((i) => i.includes('644'))).toBe(true);
    });
  });
});
