/**
 * Integration tests for the track workflow.
 *
 * Tests the full track flow with real filesystem operations, real encryption,
 * and real Git (no mocks). Verifies that state.age is encrypted and
 * contains no plaintext sensitive data.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

declare global {
  var TEST_DIR: string;
}

// Import modules under test (no mocks — real operations)
const { executeInit } = await import('../../src/commands/init.js');
const { executeTrack } = await import('../../src/commands/track.js');
const { loadKey } = await import('../../src/core/key-store.js');
const { decryptState } = await import('../../src/core/encryption.js');

describe('Integration: Track Workflow', () => {
  let testHome: string;
  let projectDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    testHome = path.join(globalThis.TEST_DIR, `track-integ-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });

    originalEnv = process.env['CTX_SYNC_HOME'];
    process.env['CTX_SYNC_HOME'] = testHome;

    // Create a real git repo to track
    projectDir = path.join(testHome, 'projects', 'test-project');
    fs.mkdirSync(projectDir, { recursive: true });
    execSync('git init', { cwd: projectDir, stdio: 'ignore' });
    execSync('git checkout -b main', { cwd: projectDir, stdio: 'ignore' });
    // Create an initial commit so branch info is available
    fs.writeFileSync(path.join(projectDir, 'README.md'), '# Test');
    execSync('git add .', { cwd: projectDir, stdio: 'ignore' });
    execSync('git commit -m "init"', {
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

    // Init ctx-sync
    await executeInit({ noInteractive: true });
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTX_SYNC_HOME'];
    } else {
      process.env['CTX_SYNC_HOME'] = originalEnv;
    }
  });

  it('should create state.age after tracking a project', async () => {
    await executeTrack({ path: projectDir, noSync: true, noInteractive: true });

    const syncDir = path.join(testHome, '.context-sync');
    expect(fs.existsSync(path.join(syncDir, 'state.age'))).toBe(true);
  });

  it('should NOT create state.json (plaintext)', async () => {
    await executeTrack({ path: projectDir, noSync: true, noInteractive: true });

    const syncDir = path.join(testHome, '.context-sync');
    expect(fs.existsSync(path.join(syncDir, 'state.json'))).toBe(false);
  });

  it('should encrypt state.age so it does not contain project name in plaintext', async () => {
    await executeTrack({
      path: projectDir,
      name: 'secret-project-name',
      noSync: true,
      noInteractive: true,
    });

    const syncDir = path.join(testHome, '.context-sync');
    const content = fs.readFileSync(path.join(syncDir, 'state.age'), 'utf-8');

    expect(content).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(content).not.toContain('secret-project-name');
  });

  it('should encrypt state.age so it does not contain project path in plaintext', async () => {
    await executeTrack({ path: projectDir, noSync: true, noInteractive: true });

    const syncDir = path.join(testHome, '.context-sync');
    const content = fs.readFileSync(path.join(syncDir, 'state.age'), 'utf-8');

    expect(content).not.toContain(projectDir);
    expect(content).not.toContain('test-project');
  });

  it('should produce state that can be decrypted back to valid data', async () => {
    await executeTrack({ path: projectDir, noSync: true, noInteractive: true });

    const syncDir = path.join(testHome, '.context-sync');
    const configDir = path.join(testHome, '.config', 'ctx-sync');
    const privateKey = loadKey(configDir);

    const ciphertext = fs.readFileSync(
      path.join(syncDir, 'state.age'),
      'utf-8',
    );
    const state = await decryptState<{
      machine: { id: string; hostname: string };
      projects: Array<{
        id: string;
        name: string;
        path: string;
        git: { branch: string };
        lastAccessed: string;
      }>;
    }>(ciphertext, privateKey);

    expect(state.machine).toBeDefined();
    expect(state.machine.hostname).toBeDefined();
    expect(state.projects).toHaveLength(1);
    const project = state.projects[0]!;
    expect(project.name).toBe('test-project');
    expect(project.path).toBe(projectDir);
    expect(project.git.branch).toBe('main');
  });

  it('should detect Git branch correctly from a real repo', async () => {
    // Switch to a feature branch
    execSync('git checkout -b feat/cool-feature', {
      cwd: projectDir,
      stdio: 'ignore',
    });

    const result = await executeTrack({ path: projectDir, noSync: true, noInteractive: true });
    expect(result.project.git.branch).toBe('feat/cool-feature');
  });

  it('should detect uncommitted changes in a real repo', async () => {
    fs.writeFileSync(path.join(projectDir, 'dirty.txt'), 'uncommitted');

    const result = await executeTrack({ path: projectDir, noSync: true, noInteractive: true });
    expect(result.project.git.hasUncommitted).toBe(true);
  });

  it('should update manifest.json with state.age entry', async () => {
    await executeTrack({ path: projectDir, noSync: true, noInteractive: true });

    const syncDir = path.join(testHome, '.context-sync');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(syncDir, 'manifest.json'), 'utf-8'),
    );

    expect(manifest.files['state.age']).toBeDefined();
    expect(manifest.files['state.age'].lastModified).toBeDefined();
  });

  it('should track multiple projects in the same state file', async () => {
    // Create a second project
    const project2 = path.join(testHome, 'projects', 'project-two');
    fs.mkdirSync(project2, { recursive: true });
    execSync('git init', { cwd: project2, stdio: 'ignore' });
    execSync('git checkout -b develop', { cwd: project2, stdio: 'ignore' });
    fs.writeFileSync(path.join(project2, 'README.md'), '# Two');
    execSync('git add . && git commit -m "init"', {
      cwd: project2,
      stdio: 'ignore',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@test.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@test.com',
      },
    });

    await executeTrack({ path: projectDir, noSync: true, noInteractive: true });
    await executeTrack({ path: project2, noSync: true, noInteractive: true });

    // Decrypt and verify both projects
    const syncDir = path.join(testHome, '.context-sync');
    const configDir = path.join(testHome, '.config', 'ctx-sync');
    const privateKey = loadKey(configDir);
    const ciphertext = fs.readFileSync(
      path.join(syncDir, 'state.age'),
      'utf-8',
    );
    const state = await decryptState<{
      projects: Array<{ name: string; git: { branch: string } }>;
    }>(ciphertext, privateKey);

    expect(state.projects).toHaveLength(2);
    expect(state.projects.map((p) => p.name)).toContain('test-project');
    expect(state.projects.map((p) => p.name)).toContain('project-two');
  });

  it('should handle tracking a directory without git', async () => {
    const noGitDir = path.join(testHome, 'projects', 'plain-folder');
    fs.mkdirSync(noGitDir, { recursive: true });

    const result = await executeTrack({ path: noGitDir, noSync: true, noInteractive: true });
    expect(result.project.git.branch).toBe('unknown');
    expect(result.project.git.remote).toBe('');
  });

  it('should commit state.age to the sync git repo', async () => {
    await executeTrack({ path: projectDir, noInteractive: true });

    const syncDir = path.join(testHome, '.context-sync');
    const log = execSync('git log --oneline', {
      cwd: syncDir,
      encoding: 'utf-8',
    });
    expect(log).toContain('track project test-project');
  });
});
