/**
 * E2E tests for `ctx-sync status`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync status', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('status');
    await env.setup();
    env.execCommand('init --no-interactive');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('status shows sync info after init', () => {
    const result = env.execCommand('status');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Sync Status');
    expect(result.stdout).toContain('Last sync');
  });

  it('status shows "up to date" when sync repo is clean', () => {
    const result = env.execCommand('status');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('up to date');
  });

  it('status shows "not configured" when no remote', () => {
    const result = env.execCommand('status');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('not configured');
  });

  it('status shows "No projects tracked" when empty', () => {
    const result = env.execCommand('status');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No projects tracked');
  });

  it('status shows project info after init → track → status', () => {
    const projectDir = path.join(env.homeDir, 'projects', 'status-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init && git checkout -b main', {
      cwd: projectDir,
      stdio: 'ignore',
    });
    fs.writeFileSync(path.join(projectDir, 'app.js'), 'const x = 1;');
    execSync('git add . && git commit -m "init"', {
      cwd: projectDir,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });

    env.execCommand(`track --path ${projectDir} --no-sync`);

    const result = env.execCommand('status');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('status-app');
    expect(result.stdout).toContain('main');
    expect(result.stdout).toContain('Projects (1)');
  });
});
