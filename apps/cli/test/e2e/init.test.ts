/**
 * E2E tests for `ctx-sync init` and `ctx-sync init --restore`.
 */

import * as fs from 'node:fs';
import { VERSION } from '@ctx-sync/shared';
import * as path from 'node:path';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync init', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('init');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('init --no-interactive completes successfully', () => {
    const result = env.execCommand('init --no-interactive');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Generating encryption key');
    expect(result.stdout).toContain('Permissions: 600');
    expect(result.stdout).toContain('All set!');
  });

  it('init creates key file with 0o600 permissions', () => {
    env.execCommand('init --no-interactive');

    const keyPath = path.join(env.configDir, 'key.txt');
    expect(fs.existsSync(keyPath)).toBe(true);

    const stats = fs.statSync(keyPath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('init creates config directory with 0o700 permissions', () => {
    env.execCommand('init --no-interactive');

    expect(fs.existsSync(env.configDir)).toBe(true);

    const stats = fs.statSync(env.configDir);
    expect(stats.mode & 0o777).toBe(0o700);
  });

  it('init creates manifest.json in sync directory', () => {
    env.execCommand('init --no-interactive');

    const manifestPath = path.join(env.syncDir, 'manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.version).toBe(VERSION);
    expect(manifest).toHaveProperty('lastSync');
    expect(manifest).toHaveProperty('files');
  });

  it('init output contains public key but not private key', () => {
    const result = env.execCommand('init --no-interactive');

    // Public key should be displayed
    expect(result.stdout).toMatch(/age1[a-z0-9]+/);

    // Private key should NOT be in output
    expect(result.stdout).not.toContain('AGE-SECRET-KEY-');
  });

  it('init initializes a git repository in sync directory', () => {
    env.execCommand('init --no-interactive');

    const gitDir = path.join(env.syncDir, '.git');
    expect(fs.existsSync(gitDir)).toBe(true);
  });

  it('init with --remote validates the URL', () => {
    const result = env.execCommand('init --no-interactive --remote http://insecure.example.com/repo.git');

    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Insecure Git remote');
  });

  it('init with valid SSH remote succeeds and shows transport validation', () => {
    const result = env.execCommand('init --no-interactive --remote git@github.com:user/repo.git');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('All set!');
    expect(result.stdout).toContain('git@github.com:user/repo.git');
    expect(result.stdout).toContain('SSH transport detected');
  });

  it('init with valid HTTPS remote shows transport validation', () => {
    const result = env.execCommand('init --no-interactive --remote https://github.com/user/repo.git');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('All set!');
    expect(result.stdout).toContain('HTTPS transport detected');
  });

  it('init --no-interactive without remote shows hint about adding remote later', () => {
    const result = env.execCommand('init --no-interactive');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No remote configured');
  });
});

describe('E2E: ctx-sync init --restore', () => {
  let envA: TestEnvironment;
  let envB: TestEnvironment;

  beforeEach(async () => {
    envA = new TestEnvironment('restore-a');
    envB = new TestEnvironment('restore-b');
    await envA.setup();
    await envB.setup();
  });

  afterEach(async () => {
    await envA.cleanup();
    await envB.cleanup();
  });

  it('restore with valid key via --stdin succeeds', () => {
    // First init on machine A to get a key
    envA.execCommand('init --no-interactive');
    const key = envA.getKey();

    // Restore on machine B
    const result = envB.execCommand('init --restore --stdin --no-interactive', {
      stdin: key,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Key restored');
    expect(result.stdout).toContain('permissions set to 600');
  });

  it('restore saves key with correct permissions', () => {
    envA.execCommand('init --no-interactive');
    const key = envA.getKey();

    envB.execCommand('init --restore --stdin --no-interactive', { stdin: key });

    const keyPath = path.join(envB.configDir, 'key.txt');
    expect(fs.existsSync(keyPath)).toBe(true);
    const stats = fs.statSync(keyPath);
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('restore with wrong key format fails', () => {
    const result = envB.execCommand('init --restore --stdin --no-interactive', {
      stdin: 'not-a-real-key',
    });

    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Invalid private key format');
  });

  it('restore creates sync directory', () => {
    envA.execCommand('init --no-interactive');
    const key = envA.getKey();

    envB.execCommand('init --restore --stdin --no-interactive', { stdin: key });

    expect(fs.existsSync(envB.syncDir)).toBe(true);
  });

  it('restore with insecure remote URL fails', () => {
    envA.execCommand('init --no-interactive');
    const key = envA.getKey();

    const result = envB.execCommand(
      'init --restore --stdin --no-interactive --remote http://insecure.com/repo.git',
      { stdin: key },
    );

    expect(result.exitCode).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('Insecure Git remote');
  });
});
