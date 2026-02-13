/**
 * Unit tests for the config command module.
 *
 * Tests the execute* functions that back the CLI commands:
 *   - executeSafeListView: returns defaults, custom, effective lists.
 *   - executeSafeListAdd: add key to safe-list, handles duplicates.
 *   - executeSafeListRemove: remove key, handles defaults and missing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_SAFE_LIST } from '@ctx-sync/shared';

declare global {
  var TEST_DIR: string;
}

const {
  executeSafeListView,
  executeSafeListAdd,
  executeSafeListRemove,
} = await import('../../src/commands/config.js');

const { saveUserConfig } = await import('../../src/core/config-store.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

function setupTestHome(): string {
  const testHome = path.join(
    TEST_DIR,
    `config-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  process.env['CTX_SYNC_HOME'] = testHome;
  return testHome;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Config Command', () => {
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env['CTX_SYNC_HOME'];
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env['CTX_SYNC_HOME'] = originalHome;
    } else {
      delete process.env['CTX_SYNC_HOME'];
    }
  });

  // ── executeSafeListView ────────────────────────────────────────────

  describe('executeSafeListView()', () => {
    it('should return default safe-list with no custom additions', () => {
      setupTestHome();
      const result = executeSafeListView();

      expect(result.defaults).toEqual(DEFAULT_SAFE_LIST);
      expect(result.custom).toEqual([]);
      expect(result.effective.length).toBe(DEFAULT_SAFE_LIST.length);
    });

    it('should include custom keys in view result', () => {
      const testHome = setupTestHome();
      const configDir = path.join(testHome, '.config', 'ctx-sync');
      saveUserConfig(configDir, { safeList: ['MY_VAR'] });

      const result = executeSafeListView();

      expect(result.custom).toEqual(['MY_VAR']);
      expect(result.effective).toContain('MY_VAR');
      expect(result.effective.length).toBe(DEFAULT_SAFE_LIST.length + 1);
    });
  });

  // ── executeSafeListAdd ─────────────────────────────────────────────

  describe('executeSafeListAdd()', () => {
    it('should add a new key successfully', () => {
      setupTestHome();
      const result = executeSafeListAdd('CUSTOM_KEY');

      expect(result.added).toBe(true);
      expect(result.message).toContain('CUSTOM_KEY');

      // Verify it's in the view
      const view = executeSafeListView();
      expect(view.custom).toContain('CUSTOM_KEY');
    });

    it('should reject keys already in default safe-list', () => {
      setupTestHome();
      const result = executeSafeListAdd('PORT');

      expect(result.added).toBe(false);
      expect(result.message).toContain('default safe-list');
    });

    it('should reject duplicate custom keys', () => {
      setupTestHome();
      executeSafeListAdd('MY_KEY');
      const result = executeSafeListAdd('MY_KEY');

      expect(result.added).toBe(false);
      expect(result.message).toContain('already');
    });
  });

  // ── executeSafeListRemove ──────────────────────────────────────────

  describe('executeSafeListRemove()', () => {
    it('should remove a custom key successfully', () => {
      setupTestHome();
      executeSafeListAdd('TO_REMOVE');
      const result = executeSafeListRemove('TO_REMOVE');

      expect(result.removed).toBe(true);

      // Verify it's gone
      const view = executeSafeListView();
      expect(view.custom).not.toContain('TO_REMOVE');
    });

    it('should refuse to remove default keys', () => {
      setupTestHome();
      const result = executeSafeListRemove('NODE_ENV');

      expect(result.removed).toBe(false);
      expect(result.message).toContain('built-in default');
    });

    it('should report when key is not found', () => {
      setupTestHome();
      const result = executeSafeListRemove('MISSING_KEY');

      expect(result.removed).toBe(false);
      expect(result.message).toContain('not in your custom safe-list');
    });
  });
});
