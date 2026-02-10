import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { initRepo, addRemote, commitState, pushState, pullState, getStatus } from '../../src/core/git-sync.js';

// Ensure globalThis.TEST_DIR is typed — needed because transitive import
// of simple-git (ESM package) changes ts-jest's compilation context.
declare global {
  var TEST_DIR: string;
}

describe('Git Operations Integration', () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = path.join(globalThis.TEST_DIR, 'integration-repo');
    fs.mkdirSync(repoDir, { recursive: true });
  });

  describe('initRepo() — real Git', () => {
    it('should create a real .git directory', async () => {
      await initRepo(repoDir);

      expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(true);
    });

    it('should be a no-op on already-initialised repo', async () => {
      await initRepo(repoDir);
      const firstInit = fs.statSync(path.join(repoDir, '.git'));

      const result = await initRepo(repoDir);
      const secondCheck = fs.statSync(path.join(repoDir, '.git'));

      expect(result).toBe(false);
      // .git dir should be unchanged
      expect(secondCheck.ino).toBe(firstInit.ino);
    });
  });

  describe('commitState() — real Git', () => {
    beforeEach(async () => {
      await initRepo(repoDir);
      // Configure git user for commits
      execSync('git config user.email "test@ctx-sync.dev"', { cwd: repoDir });
      execSync('git config user.name "Test User"', { cwd: repoDir });
    });

    it('should commit a file and show it in git log', async () => {
      // Create a test file
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'encrypted-content');

      const hash = await commitState(repoDir, ['state.age'], 'Initial state');

      expect(hash).toBeTruthy();

      // Verify commit in git log
      const log = execSync('git log --oneline', { cwd: repoDir, encoding: 'utf-8' });
      expect(log).toContain('Initial state');
    });

    it('should skip commit if no changes', async () => {
      // Create and commit a file first
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'encrypted-content');
      await commitState(repoDir, ['state.age'], 'Initial');

      // Try to commit again with no changes
      const hash = await commitState(repoDir, ['state.age'], 'Should be skipped');
      expect(hash).toBeNull();
    });

    it('should commit multiple files', async () => {
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'state-data');
      fs.writeFileSync(path.join(repoDir, 'env-vars.age'), 'env-data');
      fs.writeFileSync(path.join(repoDir, 'manifest.json'), '{"version":"1.0.0"}');

      const hash = await commitState(
        repoDir,
        ['state.age', 'env-vars.age', 'manifest.json'],
        'Full sync',
      );

      expect(hash).toBeTruthy();

      // All files should be tracked
      const tracked = execSync('git ls-files', { cwd: repoDir, encoding: 'utf-8' });
      expect(tracked).toContain('state.age');
      expect(tracked).toContain('env-vars.age');
      expect(tracked).toContain('manifest.json');
    });

    it('should detect newly created files', async () => {
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'data');

      const hash = await commitState(repoDir, ['state.age'], 'New file');
      expect(hash).toBeTruthy();
    });

    it('should detect modified files', async () => {
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'original');
      await commitState(repoDir, ['state.age'], 'First');

      // Modify the file
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'modified');
      const hash = await commitState(repoDir, ['state.age'], 'Updated');
      expect(hash).toBeTruthy();

      // Verify two commits
      const log = execSync('git log --oneline', { cwd: repoDir, encoding: 'utf-8' });
      expect(log).toContain('First');
      expect(log).toContain('Updated');
    });
  });

  describe('push/pull between two repos via a bare remote', () => {
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
      fs.writeFileSync(path.join(machineADir, 'manifest.json'), '{"version":"1.0.0"}');
      await commitState(machineADir, ['manifest.json'], 'Initial manifest');

      // Rename default branch to main
      execSync('git branch -M main', { cwd: machineADir });
    });

    it('should push from Machine A and pull to Machine B', async () => {
      // Create state on Machine A
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'encrypted-state-a');
      await commitState(machineADir, ['state.age'], 'Add state');

      // Push to remote
      await pushState(machineADir);

      // Setup Machine B — clone from remote
      await initRepo(machineBDir);
      execSync('git config user.email "b@ctx-sync.dev"', { cwd: machineBDir });
      execSync('git config user.name "Machine B"', { cwd: machineBDir });
      await addRemote(machineBDir, bareRemoteDir);

      // Pull on Machine B
      await pullState(machineBDir);

      // Verify file arrived on Machine B
      const content = fs.readFileSync(path.join(machineBDir, 'state.age'), 'utf-8');
      expect(content).toBe('encrypted-state-a');
    });

    it('should only have .age and manifest.json files in the remote', async () => {
      fs.writeFileSync(path.join(machineADir, 'state.age'), 'data');
      fs.writeFileSync(path.join(machineADir, 'env-vars.age'), 'data');
      await commitState(
        machineADir,
        ['state.age', 'env-vars.age', 'manifest.json'],
        'Sync all',
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
  });

  describe('getStatus() — real Git', () => {
    beforeEach(async () => {
      await initRepo(repoDir);
      execSync('git config user.email "test@ctx-sync.dev"', { cwd: repoDir });
      execSync('git config user.name "Test User"', { cwd: repoDir });
    });

    it('should report clean status on a fresh repo with no files', async () => {
      // Create at least one commit so status works
      fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
      await commitState(repoDir, ['.gitkeep'], 'Initial');

      const status = await getStatus(repoDir);
      expect(status.isClean).toBe(true);
      expect(status.files).toEqual([]);
    });

    it('should report untracked/modified files', async () => {
      // Create and commit a file
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'original');
      await commitState(repoDir, ['state.age'], 'Initial');

      // Modify the file
      fs.writeFileSync(path.join(repoDir, 'state.age'), 'modified');

      const status = await getStatus(repoDir);
      expect(status.isClean).toBe(false);
      expect(status.files).toContain('state.age');
    });
  });

  describe('addRemote() — real Git', () => {
    beforeEach(async () => {
      await initRepo(repoDir);
    });

    it('should add a remote to the repository', async () => {
      await addRemote(repoDir, 'git@github.com:user/repo.git');

      const remotes = execSync('git remote -v', { cwd: repoDir, encoding: 'utf-8' });
      expect(remotes).toContain('origin');
      expect(remotes).toContain('git@github.com:user/repo.git');
    });

    it('should update an existing remote URL', async () => {
      await addRemote(repoDir, 'git@github.com:user/old-repo.git');
      await addRemote(repoDir, 'git@github.com:user/new-repo.git');

      const remotes = execSync('git remote -v', { cwd: repoDir, encoding: 'utf-8' });
      expect(remotes).toContain('new-repo.git');
      expect(remotes).not.toContain('old-repo.git');
    });

    it('should reject insecure remote URLs', async () => {
      await expect(
        addRemote(repoDir, 'http://github.com/user/repo.git'),
      ).rejects.toThrow('Insecure Git remote');

      // Verify no remote was added
      const remotes = execSync('git remote -v', { cwd: repoDir, encoding: 'utf-8' });
      expect(remotes.trim()).toBe('');
    });
  });
});
