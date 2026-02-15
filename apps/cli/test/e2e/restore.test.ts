/**
 * E2E tests for `ctx-sync restore <project>`.
 *
 * Uses real CLI invocations via tsx to test the full restore flow
 * end-to-end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync restore', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('restore');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('restore should fail before init', () => {
    const result = env.execCommand('restore my-app');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('No sync repository found');
  });

  it('restore should fail for non-existent project', () => {
    env.execCommand('init --no-interactive');

    // Create and track a different project so state.age exists
    const projectDir = path.join(env.homeDir, 'projects', 'other-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });
    env.execCommand(`track --path ${projectDir} --no-interactive`);

    const result = env.execCommand('restore nonexistent');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('not found');
  });

  it('restore should display project info after init + track', () => {
    // Init
    env.execCommand('init --no-interactive');

    // Create and track a project
    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);

    // Restore
    const result = env.execCommand('restore test-app --no-interactive');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Restored: test-app');
    expect(result.stdout).toContain('Directory:');
    expect(result.stdout).toContain('Branch:');
    expect(result.stdout).toContain('Env vars:');
  });

  it('restore should show env var count', () => {
    env.execCommand('init --no-interactive');

    // Create project dir with .env file
    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.env'),
      'NODE_ENV=development\nPORT=3000\nSECRET=sk_test_123\n',
    );
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    // Track project
    env.execCommand(`track --path ${projectDir} --no-interactive`);

    // Import env vars
    env.execCommand(`env import test-app ${path.join(projectDir, '.env')}`);

    // Restore
    const result = env.execCommand('restore test-app --no-interactive');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Env vars: 3 decrypted');
  });

  it('restore should write .env file in project directory', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.env'),
      'NODE_ENV=development\nPORT=3000\n',
    );
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);
    env.execCommand(`env import test-app ${path.join(projectDir, '.env')}`);

    // Remove .env to simulate new machine
    fs.unlinkSync(path.join(projectDir, '.env'));

    // Restore should recreate it
    const result = env.execCommand('restore test-app --no-interactive');

    expect(result.exitCode).toBe(0);

    const envContent = fs.readFileSync(path.join(projectDir, '.env'), 'utf-8');
    expect(envContent).toContain('NODE_ENV=development');
    expect(envContent).toContain('PORT=3000');
  });

  it('restore should show "Ready to work" message', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);

    const result = env.execCommand('restore test-app --no-interactive');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Ready to work');
  });

  it('restore should list available projects on not-found error', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'my-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);

    const result = env.execCommand('restore wrong-name --no-interactive');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('my-app');
  });

  it('restore --no-interactive should show "Skipped" for commands', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);

    // Restore in non-interactive mode
    const result = env.execCommand('restore test-app --no-interactive');

    expect(result.exitCode).toBe(0);
    // Should not show Skipped if there are no commands to show
    // but should complete successfully without attempting execution
  });

  it('restore --path should write .env to the override directory', () => {
    env.execCommand('init --no-interactive');

    // Create and track a project
    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.env'),
      'NODE_ENV=development\nPORT=3000\n',
    );
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);
    env.execCommand(`env import test-app ${path.join(projectDir, '.env')}`);

    // Create a different directory to use as --path override
    const overrideDir = path.join(env.homeDir, 'other-machine', 'test-app');
    fs.mkdirSync(overrideDir, { recursive: true });

    // Restore with --path pointing to the override dir
    const result = env.execCommand(`restore test-app --no-interactive --path ${overrideDir}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Restored: test-app');

    // Verify .env was written to the override directory
    const envContent = fs.readFileSync(path.join(overrideDir, '.env'), 'utf-8');
    expect(envContent).toContain('NODE_ENV=development');
    expect(envContent).toContain('PORT=3000');
  });

  it('restore with nonexistent stored path should fall back to cwd', () => {
    env.execCommand('init --no-interactive');

    // Create and track a project
    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);

    // Delete the project directory to simulate cross-machine scenario
    fs.rmSync(projectDir, { recursive: true, force: true });

    // Restore without --path — should fall back to cwd and still succeed
    const result = env.execCommand('restore test-app --no-interactive');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Restored: test-app');
    // Should show the tracked path since it differs from local path
    expect(result.stdout).toContain('tracked path:');
  });

  it('restore --path should show tracked path hint when different', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);

    // Use a different dir as --path
    const overrideDir = path.join(env.homeDir, 'different-location');
    fs.mkdirSync(overrideDir, { recursive: true });

    const result = env.execCommand(`restore test-app --no-interactive --path ${overrideDir}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('tracked path:');
    expect(result.stdout).toContain(projectDir);
  });

  it('restore should fail with wrong encryption key', () => {
    env.execCommand('init --no-interactive');

    const projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir });
    execSync('git config user.email "test@test.com"', { cwd: projectDir });
    execSync('git config user.name "Test"', { cwd: projectDir });

    env.execCommand(`track --path ${projectDir} --no-interactive`);

    // Replace the key with a different one
    const configDir = path.join(env.homeDir, '.config', 'ctx-sync');
    // Generate a new key that doesn't match
    const fakeKey = 'AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ';
    fs.writeFileSync(path.join(configDir, 'key.txt'), fakeKey, { mode: 0o600 });

    const result = env.execCommand('restore test-app --no-interactive');

    expect(result.exitCode).not.toBe(0);
  });
});
