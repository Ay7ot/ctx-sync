/**
 * Unit tests for the config-store core module.
 *
 * Verifies:
 *   - getUserConfig / saveUserConfig round-trip.
 *   - getEffectiveSafeList merges defaults with custom.
 *   - addToSafeList: new key, duplicate detection, default overlap.
 *   - removeFromSafeList: custom key removal, default protection.
 *   - listSafeList: splits defaults vs custom.
 *   - Keys are normalised to uppercase.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_SAFE_LIST } from '@ctx-sync/shared';

declare global {
  var TEST_DIR: string;
}

const {
  CONFIG_FILE,
  getUserConfig,
  saveUserConfig,
  getEffectiveSafeList,
  addToSafeList,
  removeFromSafeList,
  listSafeList,
} = await import('../../src/core/config-store.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

function createTestConfigDir(): string {
  const configDir = path.join(
    TEST_DIR,
    `config-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    '.config',
    'ctx-sync',
  );
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  return configDir;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Config Store', () => {
  // ── getUserConfig / saveUserConfig ──────────────────────────────────

  describe('getUserConfig()', () => {
    it('should return null when config file does not exist', () => {
      const configDir = createTestConfigDir();
      const config = getUserConfig(configDir);
      expect(config).toBeNull();
    });

    it('should return null when config file is empty', () => {
      const configDir = createTestConfigDir();
      fs.writeFileSync(path.join(configDir, CONFIG_FILE), '', 'utf-8');
      const config = getUserConfig(configDir);
      expect(config).toBeNull();
    });

    it('should return parsed config when file exists', () => {
      const configDir = createTestConfigDir();
      const data = { safeList: ['MY_VAR', 'ANOTHER_VAR'] };
      fs.writeFileSync(
        path.join(configDir, CONFIG_FILE),
        JSON.stringify(data),
        'utf-8',
      );
      const config = getUserConfig(configDir);
      expect(config).toEqual(data);
    });
  });

  describe('saveUserConfig()', () => {
    it('should write config to disk as JSON', () => {
      const configDir = createTestConfigDir();
      const data = { safeList: ['CUSTOM_KEY'] };
      saveUserConfig(configDir, data);

      const raw = fs.readFileSync(
        path.join(configDir, CONFIG_FILE),
        'utf-8',
      );
      expect(JSON.parse(raw)).toEqual(data);
    });

    it('should create config directory if it does not exist', () => {
      const configDir = path.join(
        TEST_DIR,
        `config-new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        '.config',
        'ctx-sync',
      );
      // Directory does not exist yet
      expect(fs.existsSync(configDir)).toBe(false);

      saveUserConfig(configDir, { safeList: ['X'] });

      expect(fs.existsSync(configDir)).toBe(true);
      const config = getUserConfig(configDir);
      expect(config?.safeList).toEqual(['X']);
    });

    it('should round-trip correctly', () => {
      const configDir = createTestConfigDir();
      const original = { safeList: ['A', 'B', 'C'] };
      saveUserConfig(configDir, original);
      const loaded = getUserConfig(configDir);
      expect(loaded).toEqual(original);
    });
  });

  // ── getEffectiveSafeList ────────────────────────────────────────────

  describe('getEffectiveSafeList()', () => {
    it('should return DEFAULT_SAFE_LIST when no custom config', () => {
      const configDir = createTestConfigDir();
      const effective = getEffectiveSafeList(configDir);
      expect(effective).toEqual(expect.arrayContaining([...DEFAULT_SAFE_LIST]));
      expect(effective.length).toBe(DEFAULT_SAFE_LIST.length);
    });

    it('should merge custom keys with defaults', () => {
      const configDir = createTestConfigDir();
      saveUserConfig(configDir, { safeList: ['MY_CUSTOM_KEY'] });

      const effective = getEffectiveSafeList(configDir);
      expect(effective).toContain('MY_CUSTOM_KEY');
      expect(effective.length).toBe(DEFAULT_SAFE_LIST.length + 1);
    });

    it('should deduplicate overlapping keys', () => {
      const configDir = createTestConfigDir();
      // PORT is already in DEFAULT_SAFE_LIST
      saveUserConfig(configDir, { safeList: ['PORT', 'MY_VAR'] });

      const effective = getEffectiveSafeList(configDir);
      // PORT should appear only once
      const portCount = effective.filter((k) => k === 'PORT').length;
      expect(portCount).toBe(1);
      expect(effective).toContain('MY_VAR');
      expect(effective.length).toBe(DEFAULT_SAFE_LIST.length + 1);
    });

    it('should uppercase custom keys', () => {
      const configDir = createTestConfigDir();
      saveUserConfig(configDir, { safeList: ['my_lower_key'] });

      const effective = getEffectiveSafeList(configDir);
      expect(effective).toContain('MY_LOWER_KEY');
    });
  });

  // ── addToSafeList ──────────────────────────────────────────────────

  describe('addToSafeList()', () => {
    it('should add a new custom key', () => {
      const configDir = createTestConfigDir();
      const result = addToSafeList(configDir, 'MY_NEW_KEY');

      expect(result.added).toBe(true);
      expect(result.message).toContain('MY_NEW_KEY');

      const config = getUserConfig(configDir);
      expect(config?.safeList).toContain('MY_NEW_KEY');
    });

    it('should reject key already in default safe-list', () => {
      const configDir = createTestConfigDir();
      const result = addToSafeList(configDir, 'NODE_ENV');

      expect(result.added).toBe(false);
      expect(result.message).toContain('already in the default safe-list');
    });

    it('should reject key already in custom safe-list', () => {
      const configDir = createTestConfigDir();
      addToSafeList(configDir, 'MY_KEY');
      const result = addToSafeList(configDir, 'MY_KEY');

      expect(result.added).toBe(false);
      expect(result.message).toContain('already in your custom safe-list');
    });

    it('should normalise key to uppercase', () => {
      const configDir = createTestConfigDir();
      const result = addToSafeList(configDir, 'my_lowercase');

      expect(result.added).toBe(true);
      const config = getUserConfig(configDir);
      expect(config?.safeList).toContain('MY_LOWERCASE');
    });

    it('should handle case-insensitive duplicate detection', () => {
      const configDir = createTestConfigDir();
      addToSafeList(configDir, 'my_key');
      const result = addToSafeList(configDir, 'MY_KEY');

      expect(result.added).toBe(false);
      expect(result.message).toContain('already in your custom safe-list');
    });

    it('should accumulate multiple custom keys', () => {
      const configDir = createTestConfigDir();
      addToSafeList(configDir, 'KEY_A');
      addToSafeList(configDir, 'KEY_B');
      addToSafeList(configDir, 'KEY_C');

      const config = getUserConfig(configDir);
      expect(config?.safeList).toEqual(['KEY_A', 'KEY_B', 'KEY_C']);
    });
  });

  // ── removeFromSafeList ─────────────────────────────────────────────

  describe('removeFromSafeList()', () => {
    it('should remove a custom key', () => {
      const configDir = createTestConfigDir();
      addToSafeList(configDir, 'REMOVABLE');
      const result = removeFromSafeList(configDir, 'REMOVABLE');

      expect(result.removed).toBe(true);
      expect(result.message).toContain('Removed REMOVABLE');

      const config = getUserConfig(configDir);
      expect(config?.safeList ?? []).not.toContain('REMOVABLE');
    });

    it('should refuse to remove a default key', () => {
      const configDir = createTestConfigDir();
      const result = removeFromSafeList(configDir, 'NODE_ENV');

      expect(result.removed).toBe(false);
      expect(result.message).toContain('built-in default');
    });

    it('should report when key is not in custom list', () => {
      const configDir = createTestConfigDir();
      const result = removeFromSafeList(configDir, 'NONEXISTENT');

      expect(result.removed).toBe(false);
      expect(result.message).toContain('not in your custom safe-list');
    });

    it('should handle case-insensitive removal', () => {
      const configDir = createTestConfigDir();
      addToSafeList(configDir, 'MY_KEY');
      const result = removeFromSafeList(configDir, 'my_key');

      expect(result.removed).toBe(true);
      const config = getUserConfig(configDir);
      expect(config?.safeList ?? []).toHaveLength(0);
    });
  });

  // ── listSafeList ───────────────────────────────────────────────────

  describe('listSafeList()', () => {
    it('should return defaults and empty custom when no config', () => {
      const configDir = createTestConfigDir();
      const result = listSafeList(configDir);

      expect(result.defaults).toEqual(DEFAULT_SAFE_LIST);
      expect(result.custom).toEqual([]);
      expect(result.effective).toEqual(
        expect.arrayContaining([...DEFAULT_SAFE_LIST]),
      );
    });

    it('should split defaults and custom correctly', () => {
      const configDir = createTestConfigDir();
      addToSafeList(configDir, 'CUSTOM_A');
      addToSafeList(configDir, 'CUSTOM_B');

      const result = listSafeList(configDir);

      expect(result.defaults).toEqual(DEFAULT_SAFE_LIST);
      expect(result.custom).toEqual(['CUSTOM_A', 'CUSTOM_B']);
      expect(result.effective).toContain('CUSTOM_A');
      expect(result.effective).toContain('CUSTOM_B');
      expect(result.effective.length).toBe(DEFAULT_SAFE_LIST.length + 2);
    });
  });
});
