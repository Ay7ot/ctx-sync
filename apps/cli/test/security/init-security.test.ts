/**
 * Security tests for the init command.
 *
 * Verifies that:
 * - Private key never appears in stdout/output
 * - Only public key is shown
 * - Key file permissions are enforced
 * - Insecure remote URLs are rejected
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

declare global {
  var TEST_DIR: string;
}

/** Path to the monorepo root (where tsx is installed) */
const MONOREPO_ROOT = path.resolve(
  import.meta.dirname ?? path.join(process.cwd(), 'test', 'security'),
  '..', '..', '..', '..',
);

/** Path to CLI entry point */
const CLI_ENTRY = path.resolve(MONOREPO_ROOT, 'apps', 'cli', 'src', 'index.ts');

function runCli(
  args: string,
  homeDir: string,
  stdin?: string,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`npx tsx ${CLI_ENTRY} ${args}`, {
      cwd: MONOREPO_ROOT,
      env: {
        ...process.env,
        CTX_SYNC_HOME: homeDir,
        CTX_SYNC_TEST_MODE: 'true',
        GIT_TERMINAL_PROMPT: '0',
        // Explicit git identity so commits work in CI without global git config
        GIT_AUTHOR_NAME: process.env['GIT_AUTHOR_NAME'] || 'ctx-sync test',
        GIT_AUTHOR_EMAIL: process.env['GIT_AUTHOR_EMAIL'] || 'test@ctx-sync.local',
        GIT_COMMITTER_NAME: process.env['GIT_COMMITTER_NAME'] || 'ctx-sync test',
        GIT_COMMITTER_EMAIL: process.env['GIT_COMMITTER_EMAIL'] || 'test@ctx-sync.local',
      },
      encoding: 'utf-8',
      input: stdin,
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      exitCode: error.status ?? 1,
    };
  }
}

describe('Security: Init Command', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = path.join(globalThis.TEST_DIR, `init-sec-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });
  });

  describe('Private key never appears in stdout', () => {
    it('should not output private key during fresh init', () => {
      const result = runCli('init --no-interactive', testHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('AGE-SECRET-KEY-');
      expect(result.stderr).not.toContain('AGE-SECRET-KEY-');
    });

    it('should display public key during fresh init', () => {
      const result = runCli('init --no-interactive', testHome);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/age1[a-z0-9]+/);
    });

    it('should not output private key during restore', () => {
      // First init to get a key
      runCli('init --no-interactive', testHome);
      const key = fs
        .readFileSync(path.join(testHome, '.config', 'ctx-sync', 'key.txt'), 'utf-8')
        .trim();

      // Restore on new "machine"
      const testHome2 = path.join(globalThis.TEST_DIR, `init-sec-restore-${Date.now()}`);
      fs.mkdirSync(testHome2, { recursive: true });

      const result = runCli('init --restore --stdin --no-interactive', testHome2, key);

      expect(result.stdout).not.toContain('AGE-SECRET-KEY-');
      expect(result.stderr).not.toContain('AGE-SECRET-KEY-');

      // Cleanup
      fs.rmSync(testHome2, { recursive: true, force: true });
    });
  });

  describe('Key file permissions', () => {
    it('should create key file with exactly 0o600', () => {
      runCli('init --no-interactive', testHome);

      const keyPath = path.join(testHome, '.config', 'ctx-sync', 'key.txt');
      const stats = fs.statSync(keyPath);
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it('should create config directory with exactly 0o700', () => {
      runCli('init --no-interactive', testHome);

      const configDir = path.join(testHome, '.config', 'ctx-sync');
      const stats = fs.statSync(configDir);
      expect(stats.mode & 0o777).toBe(0o700);
    });
  });

  describe('Transport security on init', () => {
    it('should reject HTTP remote', () => {
      const result = runCli(
        'init --no-interactive --remote http://example.com/repo.git',
        testHome,
      );
      expect(result.exitCode).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain('Insecure Git remote');
    });

    it('should reject git:// remote', () => {
      const result = runCli(
        'init --no-interactive --remote git://example.com/repo.git',
        testHome,
      );
      expect(result.exitCode).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain('Insecure Git remote');
    });

    it('should reject ftp:// remote', () => {
      const result = runCli(
        'init --no-interactive --remote ftp://example.com/repo.git',
        testHome,
      );
      expect(result.exitCode).not.toBe(0);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain('Insecure Git remote');
    });

    it('should accept SSH remote', () => {
      const result = runCli(
        'init --no-interactive --remote git@github.com:user/repo.git',
        testHome,
      );
      expect(result.exitCode).toBe(0);
    });

    it('should accept HTTPS remote', () => {
      const result = runCli(
        'init --no-interactive --remote https://github.com/user/repo.git',
        testHome,
      );
      expect(result.exitCode).toBe(0);
    });
  });
});
