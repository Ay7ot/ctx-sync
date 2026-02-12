/**
 * E2E tests for `ctx-sync list`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync list', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('list');
    await env.setup();
    env.execCommand('init --no-interactive');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('list with no projects shows "No projects tracked."', () => {
    const result = env.execCommand('list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No projects tracked');
  });

  it('list shows guidance when no projects tracked', () => {
    const result = env.execCommand('list');

    expect(result.stdout).toContain('ctx-sync track');
  });

  it('list shows tracked project after init → track → list', () => {
    // Create a project
    const projectDir = path.join(env.homeDir, 'projects', 'e2e-list-app');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init && git checkout -b main', {
      cwd: projectDir,
      stdio: 'ignore',
    });
    fs.writeFileSync(path.join(projectDir, 'index.js'), 'console.log("hi")');
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

    // Track it
    env.execCommand(`track --path ${projectDir} --no-sync`);

    // List
    const result = env.execCommand('list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('e2e-list-app');
    expect(result.stdout).toContain(projectDir);
    expect(result.stdout).toContain('main');
  });

  it('list shows multiple tracked projects', () => {
    const project1 = path.join(env.homeDir, 'projects', 'first-app');
    const project2 = path.join(env.homeDir, 'projects', 'second-app');

    for (const dir of [project1, project2]) {
      fs.mkdirSync(dir, { recursive: true });
      execSync('git init && git checkout -b main', {
        cwd: dir,
        stdio: 'ignore',
      });
      fs.writeFileSync(path.join(dir, 'README.md'), '# App');
      execSync('git add . && git commit -m "init"', {
        cwd: dir,
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@test.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@test.com',
        },
      });
    }

    env.execCommand(`track --path ${project1} --no-sync`);
    env.execCommand(`track --path ${project2} --no-sync`);

    const result = env.execCommand('list');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('first-app');
    expect(result.stdout).toContain('second-app');
    expect(result.stdout).toContain('Tracked projects (2)');
  });

  it('ls alias works the same as list', () => {
    const result = env.execCommand('ls');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No projects tracked');
  });
});
