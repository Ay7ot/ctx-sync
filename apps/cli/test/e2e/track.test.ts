/**
 * E2E tests for `ctx-sync track`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync track', () => {
  let env: TestEnvironment;
  let projectDir: string;

  beforeEach(async () => {
    env = new TestEnvironment('track');
    await env.setup();

    // Init ctx-sync first
    env.execCommand('init --no-interactive');

    // Create a project directory with a git repo
    projectDir = path.join(env.homeDir, 'projects', 'my-e2e-app');
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
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('track --path completes successfully and shows project name', () => {
    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tracking project');
    expect(result.stdout).toContain('my-e2e-app');
  });

  it('track shows branch info in output', () => {
    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Branch: main');
  });

  it('track creates state.age in the sync directory', () => {
    env.execCommand(`track --path ${projectDir} --no-sync`);

    const stateFile = path.join(env.syncDir, 'state.age');
    expect(fs.existsSync(stateFile)).toBe(true);
  });

  it('track does NOT create state.json', () => {
    env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(fs.existsSync(path.join(env.syncDir, 'state.json'))).toBe(false);
  });

  it('track with --name overrides the project name', () => {
    const result = env.execCommand(
      `track --path ${projectDir} --name "Custom Name" --no-sync`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Custom Name');
  });

  it('track mentions encrypted state in output', () => {
    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.stdout).toContain('state.age');
  });

  it('track detects .env file and shows hint', () => {
    fs.writeFileSync(path.join(projectDir, '.env'), 'SECRET_KEY=abc123');

    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('.env file found');
  });

  it('track without .env does not show env hint', () => {
    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.stdout).not.toContain('.env file found');
  });

  it('track detects docker-compose.yml', () => {
    fs.writeFileSync(
      path.join(projectDir, 'docker-compose.yml'),
      'version: "3"',
    );

    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Docker Compose found');
  });

  it('track handles project without git gracefully', () => {
    const noGitDir = path.join(env.homeDir, 'projects', 'no-git-project');
    fs.mkdirSync(noGitDir, { recursive: true });

    const result = env.execCommand(`track --path ${noGitDir} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Tracking project');
    expect(result.stdout).toContain('Branch: unknown');
  });

  it('track shows uncommitted changes warning', () => {
    fs.writeFileSync(path.join(projectDir, 'dirty.txt'), 'uncommitted');

    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Uncommitted changes');
  });

  it('tracking the same project twice shows "Updated" on second run', () => {
    env.execCommand(`track --path ${projectDir} --no-sync`);
    const result = env.execCommand(`track --path ${projectDir} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated project');
  });

  it('state.age content does not contain plaintext project info', () => {
    env.execCommand(`track --path ${projectDir} --no-sync`);

    const content = fs.readFileSync(
      path.join(env.syncDir, 'state.age'),
      'utf-8',
    );

    expect(content).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(content).not.toContain('my-e2e-app');
    expect(content).not.toContain(projectDir);
  });
});
