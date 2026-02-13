/**
 * E2E tests for `ctx-sync key` and `ctx-sync audit` commands.
 *
 * Uses the TestEnvironment to run the full CLI and verify output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

let env: TestEnvironment;

beforeEach(async () => {
  env = new TestEnvironment('key-audit');
  await env.setup();
  env.execCommand('init --no-interactive');
});

afterEach(async () => {
  await env.cleanup();
});

// ─── Key Show ─────────────────────────────────────────────────────────────

describe('E2E: key show', () => {
  it('should display the public key', () => {
    const result = env.execCommand('key show');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Public key: age1');
  });

  it('should never display the private key', () => {
    const result = env.execCommand('key show');

    expect(result.stdout).not.toContain('AGE-SECRET-KEY-');
  });
});

// ─── Key Verify ───────────────────────────────────────────────────────────

describe('E2E: key verify', () => {
  it('should pass after init', () => {
    const result = env.execCommand('key verify');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Key verification passed');
    expect(result.stdout).toContain('600');
    expect(result.stdout).toContain('700');
  });

  it('should fail with insecure permissions', () => {
    // Break permissions
    fs.chmodSync(path.join(env.configDir, 'key.txt'), 0o644);

    const result = env.execCommand('key verify');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Key verification failed');
  });
});

// ─── Key Rotate ───────────────────────────────────────────────────────────

describe('E2E: key rotate', () => {
  it('should rotate the key and re-encrypt state files', () => {
    // Track a project first to create state
    const projDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, '.env'), 'NODE_ENV=test\n');

    env.execCommand(`env import test-app ${path.join(projDir, '.env')} --no-sync`);

    // Get the old public key
    const oldKeyResult = env.execCommand('key show');
    const oldPublicKey = oldKeyResult.stdout.match(/age1[a-z0-9]+/)?.[0];
    expect(oldPublicKey).toBeTruthy();

    // Rotate
    const result = env.execCommand('key rotate --no-interactive');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Key rotation complete');
    expect(result.stdout).toContain('New public key');
    expect(result.stdout).toContain('IMPORTANT');

    // Verify new key is different
    const newKeyResult = env.execCommand('key show');
    const newPublicKey = newKeyResult.stdout.match(/age1[a-z0-9]+/)?.[0];
    expect(newPublicKey).toBeTruthy();
    expect(newPublicKey).not.toBe(oldPublicKey);
  });

  it('should leave state files encrypted on disk after rotation', () => {
    const projDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, '.env'),
      'STRIPE_KEY=sk_test_abc123\n',
    );

    env.execCommand(`env import test-app ${path.join(projDir, '.env')} --no-sync`);
    env.execCommand('key rotate --no-interactive');

    // Verify files are still encrypted
    const envFile = path.join(env.syncDir, 'env-vars.age');
    if (fs.existsSync(envFile)) {
      const raw = fs.readFileSync(envFile, 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('sk_test_abc123');
    }
  });
});

// ─── Key Update ───────────────────────────────────────────────────────────

describe('E2E: key update', () => {
  it('should update the key via stdin', () => {
    // Get the current key to provide back via stdin
    const origKey = env.getKey();

    // The update command reads from stdin
    const result = env.execCommand('key update --stdin', { stdin: origKey });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Key updated');
  });

  it('should reject an invalid key via stdin', () => {
    const result = env.execCommand('key update --stdin', {
      stdin: 'not-a-valid-key\n',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid key format');
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────

describe('E2E: audit', () => {
  it('should pass on a clean setup', () => {
    const result = env.execCommand('audit');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Audit passed');
  });

  it('should report state file count', () => {
    // Create some state
    const projDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, '.env'), 'NODE_ENV=test\n');

    env.execCommand(`env import test-app ${path.join(projDir, '.env')} --no-sync`);

    const result = env.execCommand('audit');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Encrypted state files:');
  });

  it('should fail with insecure permissions', () => {
    fs.chmodSync(path.join(env.configDir, 'key.txt'), 0o644);

    const result = env.execCommand('audit');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Audit failed');
    expect(result.stdout).toContain('Critical');
  });

  it('should report repo size', () => {
    const result = env.execCommand('audit');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Repository size:');
  });

  it('should detect plaintext state files', () => {
    // Sneak in a plaintext file
    fs.writeFileSync(
      path.join(env.syncDir, 'env-vars.json'),
      '{"STRIPE_KEY": "sk_live_123"}',
    );

    const result = env.execCommand('audit');

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('env-vars.json');
  });
});

// ─── Full Workflow ────────────────────────────────────────────────────────

describe('E2E: init → env import → audit → rotate → audit', () => {
  it('should complete full workflow', () => {
    // Create project with env
    const projDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(
      path.join(projDir, '.env'),
      'NODE_ENV=development\nSTRIPE_KEY=sk_test_123\n',
    );

    // Import env
    env.execCommand(`env import test-app ${path.join(projDir, '.env')} --no-sync`);

    // Audit should pass
    const audit1 = env.execCommand('audit');
    expect(audit1.exitCode).toBe(0);

    // Rotate key
    const rotate = env.execCommand('key rotate --no-interactive');
    expect(rotate.exitCode).toBe(0);

    // Audit should still pass after rotation
    const audit2 = env.execCommand('audit');
    expect(audit2.exitCode).toBe(0);
  });
});
