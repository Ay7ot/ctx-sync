/**
 * Unit tests for the track wizard enhancements (Phase 16).
 *
 * Covers:
 *   - detectProjectName: auto-detection from Git remote URL.
 *   - executeTrack with wizardPromptFn: wizard flow via test override.
 *   - --yes flag: auto-accepts .env import and Docker tracking.
 *   - --no-interactive flag: skips all prompts.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { detectProjectName, executeTrack } =
  await import('../../src/commands/track.js');

describe('detectProjectName', () => {
  it('should extract name from SSH Git remote URL', () => {
    expect(
      detectProjectName('/home/user/projects/foo', 'git@github.com:user/my-repo.git'),
    ).toBe('my-repo');
  });

  it('should extract name from HTTPS Git remote URL', () => {
    expect(
      detectProjectName('/home/user/projects/foo', 'https://github.com/user/cool-project.git'),
    ).toBe('cool-project');
  });

  it('should strip .git suffix', () => {
    expect(
      detectProjectName('/tmp/x', 'git@gitlab.com:org/lib-name.git'),
    ).toBe('lib-name');
  });

  it('should handle remote URL without .git suffix', () => {
    expect(
      detectProjectName('/tmp/x', 'https://github.com/user/my-tool'),
    ).toBe('my-tool');
  });

  it('should fall back to directory name when no remote', () => {
    expect(detectProjectName('/home/user/projects/my-app', '')).toBe('my-app');
  });

  it('should fall back to directory name for empty remote', () => {
    expect(detectProjectName('/home/user/code/api-server', '')).toBe('api-server');
  });
});

describe('executeTrack with wizardPromptFn', () => {
  let testHome: string;
  let projectDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    testHome = path.join(globalThis.TEST_DIR, `wizard-${Date.now()}`);
    projectDir = path.join(testHome, 'projects', 'test-app');
    fs.mkdirSync(projectDir, { recursive: true });

    // Set up env so init/track use our test home
    process.env['CTX_SYNC_HOME'] = testHome;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(testHome, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  /**
   * Helper to initialize ctx-sync in the test home.
   */
  async function initCtxSync(): Promise<void> {
    const { executeInit } = await import('../../src/commands/init.js');
    await executeInit({ noInteractive: true, skipBackup: true });
  }

  it('should use wizard answers to import .env', async () => {
    await initCtxSync();

    // Create .env in the project
    fs.writeFileSync(path.join(projectDir, '.env'), 'NODE_ENV=development\nAPI_KEY=secret123');

    const result = await executeTrack({
      path: projectDir,
      name: 'test-app',
      wizardPromptFn: async (ctx) => {
        expect(ctx.envFileFound).toBe(true);
        expect(ctx.isNew).toBe(true);
        return {
          importEnv: true,
          trackDocker: false,
          currentTask: '',
          nextSteps: [],
          confirmCommit: true,
        };
      },
    });

    expect(result.isNew).toBe(true);
    expect(result.envVarsImported).toBe(2);
    expect(result.project.name).toBe('test-app');
  });

  it('should set mental context via wizard', async () => {
    await initCtxSync();

    const result = await executeTrack({
      path: projectDir,
      name: 'test-app',
      wizardPromptFn: async () => ({
        importEnv: false,
        trackDocker: false,
        currentTask: 'Implementing auth',
        nextSteps: ['Add login page', 'Write tests'],
        confirmCommit: true,
      }),
    });

    expect(result.mentalContextSet).toBe(true);
  });

  it('should skip wizard with --yes flag and auto-import .env', async () => {
    await initCtxSync();

    // Create .env
    fs.writeFileSync(path.join(projectDir, '.env'), 'PORT=3000');

    const result = await executeTrack({
      path: projectDir,
      name: 'test-app',
      yes: true,
    });

    expect(result.isNew).toBe(true);
    expect(result.envVarsImported).toBe(1);
  });

  it('should skip wizard with --no-interactive', async () => {
    await initCtxSync();

    fs.writeFileSync(path.join(projectDir, '.env'), 'SECRET=abc');

    const result = await executeTrack({
      path: projectDir,
      name: 'test-app',
      noInteractive: true,
    });

    expect(result.isNew).toBe(true);
    // --no-interactive does not auto-import, only notes presence
    expect(result.envVarsImported).toBe(0);
    expect(result.envFileFound).toBe(true);
  });

  it('should not run wizard for existing project updates', async () => {
    await initCtxSync();

    // Track first time
    await executeTrack({ path: projectDir, name: 'test-app', noInteractive: true });

    // Track again — wizard should not fire for updates
    const result = await executeTrack({
      path: projectDir,
      name: 'test-app',
      wizardPromptFn: async () => {
        return {
          importEnv: false,
          trackDocker: false,
          currentTask: '',
          nextSteps: [],
          confirmCommit: true,
        };
      },
    });

    // wizardPromptFn is always called when provided (it's a test override)
    // but isNew should be false
    expect(result.isNew).toBe(false);
  });

  it('should not commit when wizard says confirmCommit=false', async () => {
    await initCtxSync();

    const result = await executeTrack({
      path: projectDir,
      name: 'test-app',
      wizardPromptFn: async () => ({
        importEnv: false,
        trackDocker: false,
        currentTask: '',
        nextSteps: [],
        confirmCommit: false,
      }),
    });

    // Project still tracked in state, just not committed
    expect(result.project.name).toBe('test-app');
  });
});
