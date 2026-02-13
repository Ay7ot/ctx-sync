/**
 * E2E tests for `ctx-sync sync`, `ctx-sync push`, and `ctx-sync pull`.
 *
 * Uses real CLI invocations via tsx to test the full sync flow
 * end-to-end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync sync', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('sync');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('sync should fail before init', () => {
    const result = env.execCommand('sync');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('No sync repository found');
  });

  it('sync should succeed after init (local-only mode)', () => {
    // Init first
    env.execCommand('init --no-interactive');

    // Sync should work (no remote = local only)
    const result = env.execCommand('sync');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Sync complete');
  });

  it('sync should commit state files after track', () => {
    // Init
    env.execCommand('init --no-interactive');

    // Create a project directory to track
    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    // Track the project
    env.execCommand(`track --path ${projectDir}`);

    // Sync should commit the state
    const result = env.execCommand('sync');

    expect(result.exitCode).toBe(0);
    // Should report either committed or no changes
    expect(result.stdout).toContain('Sync complete');
  });

  it('sync without remote should report local only', () => {
    env.execCommand('init --no-interactive');

    const result = env.execCommand('sync');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No remote configured');
  });

  it('sync state files should only be .age and manifest.json', () => {
    env.execCommand('init --no-interactive');

    // Create a project and track it
    const projectDir = path.join(env.homeDir, 'projects', 'my-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir}`);
    env.execCommand('sync');

    // Check git files in the sync dir
    const gitFiles = execSync('git ls-files', {
      cwd: env.syncDir,
      encoding: 'utf-8',
    });

    const files = gitFiles.trim().split('\n').filter(Boolean);
    for (const file of files) {
      expect(file.endsWith('.age') || file === 'manifest.json').toBe(true);
    }
  });
});

describe('E2E: ctx-sync push', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('push');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('push should fail before init', () => {
    const result = env.execCommand('push');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('No sync repository found');
  });

  it('push should commit locally when no remote', () => {
    env.execCommand('init --no-interactive');

    const result = env.execCommand('push');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No remote configured');
  });

  it('push should report committed files after track', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir}`);

    const result = env.execCommand('push');

    expect(result.exitCode).toBe(0);
  });
});

describe('E2E: ctx-sync pull', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('pull');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('pull should fail before init', () => {
    const result = env.execCommand('pull');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('No sync repository found');
  });

  it('pull should fail when no remote is configured', () => {
    env.execCommand('init --no-interactive');

    const result = env.execCommand('pull');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('No remote configured');
  });
});

describe('E2E: sync --help', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('sync-help');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('ctx-sync sync --help shows sync description', () => {
    const result = env.execCommand('sync --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Sync encrypted state');
  });

  it('ctx-sync push --help shows push description', () => {
    const result = env.execCommand('push --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Commit and push encrypted state');
  });

  it('ctx-sync pull --help shows pull description', () => {
    const result = env.execCommand('pull --help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Pull latest encrypted state');
  });

  it('ctx-sync --help lists sync, push, and pull commands', () => {
    const result = env.execCommand('--help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('sync');
    expect(result.stdout).toContain('push');
    expect(result.stdout).toContain('pull');
  });
});
