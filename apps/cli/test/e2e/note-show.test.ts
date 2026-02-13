/**
 * E2E tests for `ctx-sync note` and `ctx-sync show`.
 *
 * Uses real CLI invocations via tsx to test the full note/show flows
 * end-to-end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync note', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('note');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('note should fail before init', () => {
    const result = env.execCommand('note my-app --no-interactive');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('No sync repository found');
  });

  it('note should fail for non-existent project', () => {
    env.execCommand('init --no-interactive');

    // Track a different project so state exists
    const projectDir = path.join(env.homeDir, 'projects', 'other-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir}`);

    const result = env.execCommand('note nonexistent --no-interactive -t "test"');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('not found');
  });

  it('note should create mental context with flags', () => {
    env.execCommand('init --no-interactive');

    // Create and track project
    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir} --no-sync`);

    // Add note with flags
    const result = env.execCommand(
      'note test-app --no-interactive --no-sync -t "Implementing webhooks" -b "Waiting for keys" -s "Add tests" -c "Started at line 23"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Mental context created');
    expect(result.stdout).toContain('test-app');
    expect(result.stdout).toContain('Implementing webhooks');

    // Verify encrypted file on disk
    const mcPath = path.join(env.syncDir, 'mental-context.age');
    expect(fs.existsSync(mcPath)).toBe(true);

    const raw = fs.readFileSync(mcPath, 'utf-8');
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).not.toContain('Implementing webhooks');
    expect(raw).not.toContain('Waiting for keys');
  });

  it('note should update existing mental context', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir} --no-sync`);

    // First note
    env.execCommand(
      'note test-app --no-interactive --no-sync -t "Initial task" -s "Step 1"',
    );

    // Update note
    const result = env.execCommand(
      'note test-app --no-interactive --no-sync -t "Updated task" -s "Step 2"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Mental context updated');
    expect(result.stdout).toContain('Updated task');
  });

  it('note should write to mental-context.age not JSON', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir} --no-sync`);

    env.execCommand(
      'note test-app --no-interactive --no-sync -t "Secret task"',
    );

    // Verify no plaintext JSON file exists
    expect(
      fs.existsSync(path.join(env.syncDir, 'mental-context.json')),
    ).toBe(false);

    // Verify .age file exists
    expect(
      fs.existsSync(path.join(env.syncDir, 'mental-context.age')),
    ).toBe(true);
  });
});

describe('E2E: ctx-sync show', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('show');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('show should fail before init', () => {
    const result = env.execCommand('show my-app');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('No sync repository found');
  });

  it('show should fail for non-existent project', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'other-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir}`);

    const result = env.execCommand('show nonexistent');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('not found');
  });

  it('show should display project info after init + track', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir} --no-sync`);

    const result = env.execCommand('show test-app');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('test-app');
    expect(result.stdout).toContain('Directory:');
    expect(result.stdout).toContain('Branch:');
  });

  it('show should display mental context after note', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir} --no-sync`);

    // Add mental context
    env.execCommand(
      'note test-app --no-interactive --no-sync -t "Building payments" -b "Need API keys" -s "Test webhooks"',
    );

    // Show should include mental context
    const result = env.execCommand('show test-app');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Mental Context');
    expect(result.stdout).toContain('Building payments');
    expect(result.stdout).toContain('Need API keys');
    expect(result.stdout).toContain('Test webhooks');
  });

  it('show with no context should display guidance', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir} --no-sync`);

    const result = env.execCommand('show test-app');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No additional context');
    expect(result.stdout).toContain('ctx-sync note');
  });

  it('full workflow: init → track → note → show → displays context', () => {
    env.execCommand('init --no-interactive');

    // Set up project
    const projectDir = path.join(env.homeDir, 'projects', 'my-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    // Track
    env.execCommand(`track --path ${projectDir} --no-sync`);

    // Note
    env.execCommand(
      'note my-app --no-interactive --no-sync -t "Implementing Stripe webhooks" -b "Waiting for staging API keys" -s "Test with Stripe CLI" -s "Add error handling" -c "Started at line 23"',
    );

    // Show
    const result = env.execCommand('show my-app');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('my-app');
    expect(result.stdout).toContain('Implementing Stripe webhooks');
    expect(result.stdout).toContain('Waiting for staging API keys');
    expect(result.stdout).toContain('Test with Stripe CLI');
    expect(result.stdout).toContain('Started at line 23');
  });
});
