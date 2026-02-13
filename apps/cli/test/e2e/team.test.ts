/**
 * E2E tests for `ctx-sync team` commands.
 *
 * Uses the TestEnvironment to run the full CLI and verify output.
 */

import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

const { generateKey } = await import('../../src/core/encryption.js');

let env: TestEnvironment;

beforeEach(async () => {
  env = new TestEnvironment('team');
  await env.setup();
  env.execCommand('init --no-interactive');
});

afterEach(async () => {
  await env.cleanup();
});

// ─── Team List ────────────────────────────────────────────────────────────

describe('E2E: team list', () => {
  it('should show owner key with no members', () => {
    const result = env.execCommand('team list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Owner key: age1');
    expect(result.stdout).toContain('No team members added yet');
  });

  it('should list added members', async () => {
    const bobKeys = await generateKey();
    env.execCommand(`team add --name Bob --key ${bobKeys.publicKey} --no-verify`);

    const result = env.execCommand('team list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Bob');
    expect(result.stdout).toContain(bobKeys.publicKey);
    expect(result.stdout).toContain('Fingerprint:');
    expect(result.stdout).toContain('Team members (1)');
  });
});

// ─── Team Add ─────────────────────────────────────────────────────────────

describe('E2E: team add', () => {
  it('should add a team member', async () => {
    const bobKeys = await generateKey();

    const result = env.execCommand(
      `team add --name Bob --key ${bobKeys.publicKey} --no-verify`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Added team member: Bob');
    expect(result.stdout).toContain('Fingerprint:');
    expect(result.stdout).toContain('re-encrypted');
  });

  it('should reject invalid key', () => {
    const result = env.execCommand(
      'team add --name Bad --key invalid-key --no-verify',
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Invalid Age public key format');
  });

  it('should reject duplicate name', async () => {
    const key1 = (await generateKey()).publicKey;
    const key2 = (await generateKey()).publicKey;

    env.execCommand(`team add --name Bob --key ${key1} --no-verify`);
    const result = env.execCommand(
      `team add --name Bob --key ${key2} --no-verify`,
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('already exists');
  });
});

// ─── Team Remove ──────────────────────────────────────────────────────────

describe('E2E: team remove', () => {
  it('should remove a team member', async () => {
    const bobKeys = await generateKey();
    env.execCommand(
      `team add --name Bob --key ${bobKeys.publicKey} --no-verify`,
    );

    const result = env.execCommand('team remove Bob');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed team member: Bob');
    expect(result.stdout).toContain('can no longer decrypt');
  });

  it('should reject unknown name', () => {
    const result = env.execCommand('team remove Unknown');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No team member found');
  });
});

// ─── Team Revoke ──────────────────────────────────────────────────────────

describe('E2E: team revoke', () => {
  it('should revoke by public key', async () => {
    const bobKeys = await generateKey();
    env.execCommand(
      `team add --name Bob --key ${bobKeys.publicKey} --no-verify`,
    );

    const result = env.execCommand(`team revoke ${bobKeys.publicKey}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Revoked key for: Bob');
    expect(result.stdout).toContain('can no longer decrypt');
  });

  it('should reject unknown key', () => {
    const result = env.execCommand('team revoke age1unknownkey12345');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No team member found');
  });
});
