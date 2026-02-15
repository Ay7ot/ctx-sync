import { VERSION } from '@ctx-sync/shared';

/**
 * Integration tests for the sync workflow.
 *
 * These tests use real Git repos (bare remote + two "machines") to verify
 * the full sync flow: init → track → sync → push/pull between machines.
 * All state files must be .age (encrypted) — no plaintext in Git.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { initRepo, addRemote, commitState, pushState, pullState, getStatus } from '../../src/core/git-sync.js';
import { writeManifest, readManifest } from '../../src/core/state-manager.js';
import { collectSyncFiles, validateSyncRemote } from '../../src/commands/sync.js';

declare global {
  var TEST_DIR: string;
}

describe('Sync Workflow Integration', () => {
  let machineADir: string;
  let machineBDir: string;
  let bareRemoteDir: string;

  beforeEach(async () => {
    machineADir = path.join(globalThis.TEST_DIR, 'machine-a');
    machineBDir = path.join(globalThis.TEST_DIR, 'machine-b');
    bareRemoteDir = path.join(globalThis.TEST_DIR, 'remote.git');

    // Create bare remote repo
    fs.mkdirSync(bareRemoteDir, { recursive: true });
    execSync('git init --bare', { cwd: bareRemoteDir });

    // Setup Machine A
    await initRepo(machineADir);
    execSync('git config user.email "a@ctx-sync.dev"', { cwd: machineADir });
    execSync('git config user.name "Machine A"', { cwd: machineADir });
    await addRemote(machineADir, bareRemoteDir);

    // Create initial commit on Machine A so 'main' branch exists
    writeManifest(machineADir, {
      version: VERSION,
      lastSync: new Date().toISOString(),
      files: {},
    });
    await commitState(machineADir, ['manifest.json'], 'Initial manifest');
    execSync('git branch -M main', { cwd: machineADir });
  });

  describe('full sync between machines', () => {
    it('should sync .age files from Machine A to Machine B', async () => {
      // Machine A: Create state files
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'encrypted-state-data');
      fs.writeFileSync(path.join(machineADir, 'env-vars.age'), 'encrypted-env-data');

      // Commit and push from Machine A
      await commitState(
        machineADir,
        ['state.age', 'env-vars.age', 'manifest.json'],
        'sync: push encrypted state',
      );
      await pushState(machineADir);

      // Setup Machine B
      await initRepo(machineBDir);
      execSync('git config user.email "b@ctx-sync.dev"', { cwd: machineBDir });
      execSync('git config user.name "Machine B"', { cwd: machineBDir });
      await addRemote(machineBDir, bareRemoteDir);

      // Pull on Machine B
      await pullState(machineBDir);

      // Verify files arrived
      expect(
        fs.readFileSync(path.join(machineBDir, 'state.age'), 'utf-8'),
      ).toBe('encrypted-state-data');
      expect(
        fs.readFileSync(path.join(machineBDir, 'env-vars.age'), 'utf-8'),
      ).toBe('encrypted-env-data');
    });

    it('should only contain .age files and manifest.json in remote', async () => {
      // Machine A: Create various state files
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'encrypted');
      fs.writeFileSync(path.join(machineADir, 'env-vars.age'), 'encrypted');
      fs.writeFileSync(path.join(machineADir, 'docker-state.age'), 'encrypted');
      fs.writeFileSync(path.join(machineADir, 'mental-context.age'), 'encrypted');

      await commitState(
        machineADir,
        ['state.age', 'env-vars.age', 'docker-state.age', 'mental-context.age', 'manifest.json'],
        'sync: full state',
      );
      await pushState(machineADir);

      // Inspect the remote repo
      const remoteFiles = execSync('git ls-tree --name-only HEAD', {
        cwd: bareRemoteDir,
        encoding: 'utf-8',
      });

      const files = remoteFiles.trim().split('\n');
      for (const file of files) {
        expect(file.endsWith('.age') || file === 'manifest.json').toBe(true);
      }
    });

    it('should not contain plaintext in Git log', async () => {
      // Machine A: Create state with identifiable content
      fs.writeFileSync(
        path.join(machineADir, 'state.age'),
        '-----BEGIN AGE ENCRYPTED FILE-----\nciphertext\n-----END AGE ENCRYPTED FILE-----',
      );
      writeManifest(machineADir, {
        version: VERSION,
        lastSync: new Date().toISOString(),
        files: { 'state.age': { lastModified: new Date().toISOString() } },
      });

      await commitState(
        machineADir,
        ['state.age', 'manifest.json'],
        'sync: update encrypted state',
      );

      const gitLog = execSync('git log -p', {
        cwd: machineADir,
        encoding: 'utf-8',
      });

      // No JSON structure in Git log (everything is encrypted)
      expect(gitLog).not.toContain('"projects"');
      expect(gitLog).not.toContain('"gitBranch"');
      expect(gitLog).not.toContain('"currentTask"');
    });
  });

  describe('collectSyncFiles()', () => {
    it('should collect all .age files and manifest', () => {
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'data');
      fs.writeFileSync(path.join(machineADir, 'env-vars.age'), 'data');

      const files = collectSyncFiles(machineADir);

      expect(files).toContain('state.age');
      expect(files).toContain('env-vars.age');
      expect(files).toContain('manifest.json');
    });

    it('should not include .git or other non-state files', () => {
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'data');
      fs.writeFileSync(path.join(machineADir, 'notes.txt'), 'data');

      const files = collectSyncFiles(machineADir);

      expect(files).toContain('state.age');
      expect(files).not.toContain('notes.txt');
      expect(files).not.toContain('.git');
    });
  });

  describe('push then pull', () => {
    it('should roundtrip state via push on A then pull on B', async () => {
      // Create state on Machine A
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'roundtrip-test-data');
      writeManifest(machineADir, {
        version: VERSION,
        lastSync: new Date().toISOString(),
        files: { 'state.age': { lastModified: new Date().toISOString() } },
      });

      await commitState(machineADir, ['state.age', 'manifest.json'], 'sync: push');
      await pushState(machineADir);

      // Setup Machine B
      await initRepo(machineBDir);
      execSync('git config user.email "b@ctx-sync.dev"', { cwd: machineBDir });
      execSync('git config user.name "Machine B"', { cwd: machineBDir });
      await addRemote(machineBDir, bareRemoteDir);

      // Pull on Machine B
      await pullState(machineBDir);

      // Verify data matches
      const content = fs.readFileSync(path.join(machineBDir, 'state.age'), 'utf-8');
      expect(content).toBe('roundtrip-test-data');

      const manifestB = readManifest(machineBDir);
      expect(manifestB).not.toBeNull();
      expect(manifestB!.version).toBe(VERSION);
    });
  });

  describe('offline mode (no remote)', () => {
    it('should commit locally when no remote is configured', async () => {
      const localOnlyDir = path.join(globalThis.TEST_DIR, 'local-only');
      await initRepo(localOnlyDir);
      execSync('git config user.email "test@ctx-sync.dev"', { cwd: localOnlyDir });
      execSync('git config user.name "Test"', { cwd: localOnlyDir });

      fs.writeFileSync(path.join(localOnlyDir, 'state.age'), 'local-data');
      writeManifest(localOnlyDir, {
        version: VERSION,
        lastSync: new Date().toISOString(),
        files: {},
      });

      const hash = await commitState(
        localOnlyDir,
        ['state.age', 'manifest.json'],
        'sync: local commit',
      );

      expect(hash).toBeTruthy();

      // Verify in git log
      const log = execSync('git log --oneline', { cwd: localOnlyDir, encoding: 'utf-8' });
      expect(log).toContain('sync: local commit');

      // Push should be a no-op (no remote)
      await pushState(localOnlyDir);
      // No error means success (silently skipped)
    });
  });

  describe('validateSyncRemote()', () => {
    it('should return URL for secure remote', async () => {
      const url = await validateSyncRemote(machineADir);
      // bareRemoteDir is a local filesystem path, which is allowed
      expect(url).toBeTruthy();
    });

    it('should return null when no remote exists', async () => {
      const noRemoteDir = path.join(globalThis.TEST_DIR, 'no-remote');
      await initRepo(noRemoteDir);

      const url = await validateSyncRemote(noRemoteDir);
      expect(url).toBeNull();
    });
  });

  describe('status tracking', () => {
    it('should report clean status after sync', async () => {
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'data');

      await commitState(machineADir, ['state.age', 'manifest.json'], 'sync');

      const status = await getStatus(machineADir);
      expect(status.isClean).toBe(true);
    });

    it('should report dirty status when files are modified', async () => {
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'original');
      await commitState(machineADir, ['state.age', 'manifest.json'], 'Initial');

      // Modify
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'modified');

      const status = await getStatus(machineADir);
      expect(status.isClean).toBe(false);
      expect(status.files).toContain('state.age');
    });
  });
});
