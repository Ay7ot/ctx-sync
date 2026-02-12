/**
 * E2E test environment helper.
 *
 * Creates isolated test directories simulating a user's home,
 * and provides methods to run CLI commands against that environment.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

/** Path to the monorepo root (where tsx is installed) */
const MONOREPO_ROOT = path.resolve(
  import.meta.dirname ?? path.join(process.cwd(), 'test', 'e2e', 'helpers'),
  '..', '..', '..', '..', '..',
);

/** Path to the CLI entry point (TypeScript source, run via tsx) */
const CLI_ENTRY = path.resolve(MONOREPO_ROOT, 'apps', 'cli', 'src', 'index.ts');

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class TestEnvironment {
  public readonly homeDir: string;
  public readonly configDir: string;
  public readonly syncDir: string;

  constructor(name: string = 'default') {
    this.homeDir = path.join(globalThis.TEST_DIR, `e2e-${name}-${Date.now()}`);
    this.configDir = path.join(this.homeDir, '.config', 'ctx-sync');
    this.syncDir = path.join(this.homeDir, '.context-sync');
  }

  async setup(): Promise<void> {
    fs.mkdirSync(this.homeDir, { recursive: true });
  }

  async cleanup(): Promise<void> {
    fs.rmSync(this.homeDir, { recursive: true, force: true });
  }

  /**
   * Run a ctx-sync CLI command in the test environment.
   * Runs tsx from the monorepo root to ensure it's found.
   */
  execCommand(args: string, options?: { stdin?: string }): ExecResult {
    const cmd = `npx tsx ${CLI_ENTRY} ${args}`;
    try {
      const stdout = execSync(cmd, {
        cwd: MONOREPO_ROOT,
        env: {
          ...process.env,
          CTX_SYNC_HOME: this.homeDir,
          CTX_SYNC_TEST_MODE: 'true',
          GIT_TERMINAL_PROMPT: '0',
          NODE_PATH: path.join(MONOREPO_ROOT, 'node_modules'),
        },
        encoding: 'utf-8',
        input: options?.stdin,
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

  /** Get the saved key from the config dir */
  getKey(): string {
    return fs.readFileSync(path.join(this.configDir, 'key.txt'), 'utf-8').trim();
  }
}
