/**
 * E2E tests for the track wizard and --yes flag.
 *
 * Covers:
 *   - `--yes` flag skips prompts and auto-imports .env.
 *   - Wizard flow produces correct state (via --yes shortcut).
 *   - `--no-interactive` skips all wizard prompts.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: Track Wizard', () => {
  let env: TestEnvironment;
  let projectDir: string;

  beforeEach(async () => {
    env = new TestEnvironment('track-wizard');
    await env.setup();

    // Create a test project with .env and git
    projectDir = path.join(env.homeDir, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.env'),
      'NODE_ENV=development\nAPI_KEY=secret123\nPORT=3000',
    );

    // Init git in the project
    const { execSync } = await import('node:child_process');
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
      cwd: projectDir,
      stdio: 'pipe',
    });

    // Init ctx-sync
    env.execCommand('init --no-interactive --skip-backup');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should track project with --yes and auto-import .env', () => {
    const result = env.execCommand(`track --yes --path ${projectDir}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tracking project');
    expect(result.stdout).toContain('Imported 3 env vars');
    expect(result.stdout).toContain('all encrypted');
  });

  it('should track with --no-interactive and not auto-import', () => {
    const result = env.execCommand(`track --no-interactive --path ${projectDir}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tracking project');
    // .env noted but NOT auto-imported
    expect(result.stdout).toContain('.env file found');
    expect(result.stdout).not.toContain('Imported');
  });

  it('should use directory name as project name by default', () => {
    const result = env.execCommand(`track --yes --path ${projectDir}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('test-app');
  });

  it('should accept --name override', () => {
    const result = env.execCommand(`track --yes --name my-custom-name --path ${projectDir}`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('my-custom-name');
  });

  it('should show branch info', () => {
    const result = env.execCommand(`track --yes --path ${projectDir}`);

    expect(result.exitCode).toBe(0);
    // Git branch should be shown (main or master depending on git version)
    expect(result.stdout).toMatch(/Branch:/);
  });
});
