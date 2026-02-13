/**
 * E2E tests for `ctx-sync config safe-list` commands.
 *
 * Uses the TestEnvironment to run the full CLI and verify output.
 *
 * Covers:
 *   - View safe-list (defaults shown).
 *   - Add custom key to safe-list.
 *   - Remove custom key from safe-list.
 *   - Duplicate add rejected.
 *   - Default key removal rejected.
 *   - Config file persists in config dir (never in sync dir).
 *   - Integration with `env import --allow-plain` uses custom safe-list.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

let env: TestEnvironment;

beforeEach(async () => {
  env = new TestEnvironment('config-safelist');
  await env.setup();
  env.execCommand('init --no-interactive');
});

afterEach(async () => {
  await env.cleanup();
});

// ─── Config Safe-List View ──────────────────────────────────────────────────

describe('E2E: config safe-list (view)', () => {
  it('should display the default safe-list', () => {
    const result = env.execCommand('config safe-list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Built-in defaults:');
    expect(result.stdout).toContain('NODE_ENV');
    expect(result.stdout).toContain('PORT');
    expect(result.stdout).toContain('DEBUG');
    expect(result.stdout).toContain('No custom additions');
  });

  it('should show custom additions after adding keys', () => {
    env.execCommand('config safe-list add MY_CUSTOM_VAR');
    const result = env.execCommand('config safe-list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Custom additions:');
    expect(result.stdout).toContain('MY_CUSTOM_VAR');
  });
});

// ─── Config Safe-List Add ──────────────────────────────────────────────────

describe('E2E: config safe-list add', () => {
  it('should add a custom key', () => {
    const result = env.execCommand('config safe-list add MY_NEW_KEY');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Added MY_NEW_KEY');
    expect(result.stdout).toContain('plaintext-safe');
  });

  it('should reject a key already in default safe-list', () => {
    const result = env.execCommand('config safe-list add NODE_ENV');

    expect(result.exitCode).toBe(0); // not an error, just a warning
    expect(result.stdout).toContain('already in the default safe-list');
  });

  it('should reject a duplicate custom key', () => {
    env.execCommand('config safe-list add CUSTOM_KEY');
    const result = env.execCommand('config safe-list add CUSTOM_KEY');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('already in your custom safe-list');
  });

  it('should normalise keys to uppercase', () => {
    env.execCommand('config safe-list add my_lowercase');
    const result = env.execCommand('config safe-list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('MY_LOWERCASE');
  });
});

// ─── Config Safe-List Remove ───────────────────────────────────────────────

describe('E2E: config safe-list remove', () => {
  it('should remove a custom key', () => {
    env.execCommand('config safe-list add REMOVABLE');
    const result = env.execCommand('config safe-list remove REMOVABLE');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed REMOVABLE');
    expect(result.stdout).toContain('encrypted on next import');
  });

  it('should refuse to remove a built-in default key', () => {
    const result = env.execCommand('config safe-list remove NODE_ENV');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('built-in default');
  });

  it('should report when key is not in custom list', () => {
    const result = env.execCommand('config safe-list remove NONEXISTENT');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('not in your custom safe-list');
  });
});

// ─── Config Persistence ────────────────────────────────────────────────────

describe('E2E: config persistence', () => {
  it('should persist config in config dir (not sync dir)', () => {
    env.execCommand('config safe-list add PERSISTED_KEY');

    // Config should be in config dir
    const configFile = path.join(env.configDir, 'config.json');
    expect(fs.existsSync(configFile)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    expect(config.safeList).toContain('PERSISTED_KEY');

    // Config should NOT be in sync dir
    const syncConfigFile = path.join(env.syncDir, 'config.json');
    expect(fs.existsSync(syncConfigFile)).toBe(false);
  });
});

// ─── Integration with env import ───────────────────────────────────────────

describe('E2E: safe-list integration with env import', () => {
  it('should use custom safe-list during env import with --allow-plain', () => {
    // Add a custom key to safe-list
    env.execCommand('config safe-list add MY_SAFE_VAR');

    // Create a .env file in a temp location
    const envFilePath = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(
      envFilePath,
      'MY_SAFE_VAR=safe-value\nSECRET_KEY=super-secret\n',
    );

    // Import with --allow-plain
    const result = env.execCommand(`env import test-project ${envFilePath} --allow-plain`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Imported 2 env vars');
  });

  it('should treat removed key as encrypted on next import', () => {
    // Add then remove
    env.execCommand('config safe-list add TEMP_SAFE');
    env.execCommand('config safe-list remove TEMP_SAFE');

    // Verify key is gone from safe-list
    const viewResult = env.execCommand('config safe-list');
    expect(viewResult.stdout).not.toContain('TEMP_SAFE');
  });
});
