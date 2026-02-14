/**
 * E2E tests for CLI basics: --version, --help, unknown commands.
 */

import { createRequire } from 'node:module';
import { TestEnvironment } from './helpers/test-env.js';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json') as { version: string };

declare global {
  var TEST_DIR: string;
}

describe('E2E: CLI Basics', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('cli-basics');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('ctx-sync --version prints version string', () => {
    const result = env.execCommand('--version');

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('ctx-sync -V prints version string', () => {
    const result = env.execCommand('-V');

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('ctx-sync --help prints help text listing commands', () => {
    const result = env.execCommand('--help');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('ctx-sync');
    expect(result.stdout).toContain('init');
    expect(result.stdout).toContain('Sync your complete development context');
  });

  it('ctx-sync with unknown command exits with non-zero', () => {
    const result = env.execCommand('nonexistent-command');

    // Commander shows error for unknown commands
    expect(result.exitCode).not.toBe(0);
  });

  it('version matches package.json', () => {
    const result = env.execCommand('--version');
    expect(result.stdout.trim()).toBe(pkg.version);
  });
});
