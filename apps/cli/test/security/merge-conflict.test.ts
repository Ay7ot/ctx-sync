/**
 * Security tests for merge conflict handling on encrypted files.
 *
 * Validates that:
 *   - .age files are NEVER auto-merged (binary merge would corrupt them)
 *   - Conflicts on encrypted files require explicit resolution
 *   - Transport security is validated on every sync operation
 *   - Only .age + manifest.json files end up in Git
 */
import { VERSION } from '@ctx-sync/shared';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { initRepo, addRemote, commitState, pushState, pullState } from '../../src/core/git-sync.js';
import { writeManifest } from '../../src/core/state-manager.js';
import { collectSyncFiles } from '../../src/commands/sync.js';

declare global {
  var TEST_DIR: string;
}

describe('Security: Merge Conflict Handling', () => {
  let machineADir: string;
  let machineBDir: string;
  let bareRemoteDir: string;

  beforeEach(async () => {
    machineADir = path.join(globalThis.TEST_DIR, 'sec-machine-a');
    machineBDir = path.join(globalThis.TEST_DIR, 'sec-machine-b');
    bareRemoteDir = path.join(globalThis.TEST_DIR, 'sec-remote.git');

    // Create bare remote
    fs.mkdirSync(bareRemoteDir, { recursive: true });
    execSync('git init --bare -b main', { cwd: bareRemoteDir });

    // Setup Machine A
    await initRepo(machineADir);
    execSync('git config user.email "a@ctx-sync.dev"', { cwd: machineADir });
    execSync('git config user.name "Machine A"', { cwd: machineADir });
    await addRemote(machineADir, bareRemoteDir);

    // Initial commit on Machine A
    writeManifest(machineADir, {
      version: VERSION,
      lastSync: new Date().toISOString(),
      files: {},
    });
    fs.writeFileSync(path.join(machineADir, 'state.age'), 'initial-encrypted-state');
    await commitState(machineADir, ['state.age', 'manifest.json'], 'Initial state');
    execSync('git branch -M main', { cwd: machineADir });
    await pushState(machineADir);

    // Setup Machine B (clone from remote)
    await initRepo(machineBDir);
    execSync('git config user.email "b@ctx-sync.dev"', { cwd: machineBDir });
    execSync('git config user.name "Machine B"', { cwd: machineBDir });
    execSync('git config pull.rebase false', { cwd: machineBDir });
    await addRemote(machineBDir, bareRemoteDir);
    await pullState(machineBDir);
  });

  it('should detect conflicting .age files when both machines modify', async () => {
    // Machine A: Modify state.age
    fs.writeFileSync(path.join(machineADir, 'state.age'), 'encrypted-state-from-A');
    await commitState(machineADir, ['state.age'], 'Machine A update');
    await pushState(machineADir);

    // Machine B: Also modify state.age (diverged)
    fs.writeFileSync(path.join(machineBDir, 'state.age'), 'encrypted-state-from-B');
    await commitState(machineBDir, ['state.age'], 'Machine B update');

    // Machine B tries to pull → should get a conflict or error
    let conflictOrErrorDetected = false;
    try {
      await pullState(machineBDir);
    } catch {
      // Git will fail with a conflict or "divergent branches" error
      conflictOrErrorDetected = true;
    }

    expect(conflictOrErrorDetected).toBe(true);
  });

  it('should preserve .age file integrity after conflict resolution (keep ours)', async () => {
    // Machine A: Modify
    fs.writeFileSync(path.join(machineADir, 'state.age'), 'encrypted-from-A');
    await commitState(machineADir, ['state.age'], 'A update');
    await pushState(machineADir);

    // Machine B: Modify (diverged)
    fs.writeFileSync(path.join(machineBDir, 'state.age'), 'encrypted-from-B');
    await commitState(machineBDir, ['state.age'], 'B update');

    // Pull with manual conflict resolution — use fetch + merge to control resolution
    execSync('git fetch origin', { cwd: machineBDir });
    try {
      execSync('git merge origin/main --no-edit', { cwd: machineBDir });
    } catch {
      // Resolve by keeping ours
      execSync('git checkout --ours state.age', { cwd: machineBDir });
      execSync('git add state.age', { cwd: machineBDir });
      execSync('git commit -m "Resolved: keep local" --no-edit', { cwd: machineBDir });
    }

    // Machine B should have its own version
    const content = fs.readFileSync(path.join(machineBDir, 'state.age'), 'utf-8');
    expect(content).toBe('encrypted-from-B');
  });

  it('should preserve .age file integrity after conflict resolution (keep theirs)', async () => {
    // Machine A: Modify
    fs.writeFileSync(path.join(machineADir, 'state.age'), 'encrypted-from-A');
    await commitState(machineADir, ['state.age'], 'A update');
    await pushState(machineADir);

    // Machine B: Modify (diverged)
    fs.writeFileSync(path.join(machineBDir, 'state.age'), 'encrypted-from-B');
    await commitState(machineBDir, ['state.age'], 'B update');

    // Pull with manual conflict resolution — use fetch + merge to control resolution
    execSync('git fetch origin', { cwd: machineBDir });
    try {
      execSync('git merge origin/main --no-edit', { cwd: machineBDir });
    } catch {
      // Resolve by keeping theirs
      execSync('git checkout --theirs state.age', { cwd: machineBDir });
      execSync('git add state.age', { cwd: machineBDir });
      execSync('git commit -m "Resolved: take remote" --no-edit', { cwd: machineBDir });
    }

    // Machine B should now have Machine A's version
    const content = fs.readFileSync(path.join(machineBDir, 'state.age'), 'utf-8');
    expect(content).toBe('encrypted-from-A');
  });

  it('should never have plaintext JSON state files in Git', async () => {
    // Create a bunch of state files
    fs.writeFileSync(path.join(machineADir, 'state.age'), 'encrypted');
    fs.writeFileSync(path.join(machineADir, 'env-vars.age'), 'encrypted');
    fs.writeFileSync(path.join(machineADir, 'docker-state.age'), 'encrypted');

    writeManifest(machineADir, {
      version: VERSION,
      lastSync: new Date().toISOString(),
      files: {
        'state.age': { lastModified: new Date().toISOString() },
        'env-vars.age': { lastModified: new Date().toISOString() },
        'docker-state.age': { lastModified: new Date().toISOString() },
      },
    });

    await commitState(
      machineADir,
      ['state.age', 'env-vars.age', 'docker-state.age', 'manifest.json'],
      'Full sync',
    );
    await pushState(machineADir);

    // Check all files in Git
    const gitFiles = execSync('git ls-tree --name-only HEAD', {
      cwd: bareRemoteDir,
      encoding: 'utf-8',
    });

    const files = gitFiles.trim().split('\n');
    for (const file of files) {
      // Only .age files and manifest.json allowed
      expect(
        file.endsWith('.age') || file === 'manifest.json',
      ).toBe(true);

      // No plaintext JSON state files
      if (file !== 'manifest.json') {
        expect(file.endsWith('.json')).toBe(false);
      }
    }

    // Specifically, these should NOT be present
    expect(files).not.toContain('state.json');
    expect(files).not.toContain('env-vars.json');
    expect(files).not.toContain('docker-state.json');
  });

  it('should validate transport security on sync operations', async () => {
    // Try to add an insecure remote
    const insecureDir = path.join(globalThis.TEST_DIR, 'insecure-test');
    await initRepo(insecureDir);

    await expect(
      addRemote(insecureDir, 'http://insecure.com/repo.git'),
    ).rejects.toThrow('Insecure Git remote');

    await expect(
      addRemote(insecureDir, 'git://github.com/user/repo.git'),
    ).rejects.toThrow('Insecure Git remote');

    await expect(
      addRemote(insecureDir, 'ftp://server.com/repo.git'),
    ).rejects.toThrow('Insecure Git remote');
  });

  it('should only sync .age files and manifest.json (collectSyncFiles)', () => {
    // Place various files in the sync dir
    fs.writeFileSync(path.join(machineADir, 'state.age'), 'data');
    fs.writeFileSync(path.join(machineADir, 'env-vars.age'), 'data');
    fs.writeFileSync(path.join(machineADir, 'random-notes.txt'), 'data');
    fs.writeFileSync(path.join(machineADir, 'secrets.json'), '{}');

    const files = collectSyncFiles(machineADir);

    expect(files).toContain('state.age');
    expect(files).toContain('env-vars.age');
    expect(files).toContain('manifest.json');
    expect(files).not.toContain('random-notes.txt');
    expect(files).not.toContain('secrets.json');
  });

  it('manifest.json should contain only version, lastSync, and files metadata', async () => {
    writeManifest(machineADir, {
      version: VERSION,
      lastSync: new Date().toISOString(),
      files: {
        'state.age': { lastModified: new Date().toISOString() },
      },
    });

    await commitState(machineADir, ['manifest.json'], 'Update manifest');
    await pushState(machineADir);

    // Pull on Machine B
    await pullState(machineBDir);

    const manifestStr = fs.readFileSync(path.join(machineBDir, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(manifestStr);

    // Only allowed keys
    const keys = Object.keys(manifest);
    expect(keys).toContain('version');
    expect(keys).toContain('lastSync');
    expect(keys).toContain('files');

    // No sensitive data in manifest
    expect(manifestStr).not.toContain('my-app');
    expect(manifestStr).not.toContain('/projects/');
    expect(manifestStr).not.toContain('STRIPE');
    expect(manifestStr).not.toContain('sk_live');
  });
});
