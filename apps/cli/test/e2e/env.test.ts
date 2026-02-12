/**
 * E2E tests for `ctx-sync env` commands.
 *
 * Tests the full CLI for env import, env add, env list, and env scan
 * using the TestEnvironment helper (real process execution).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: ctx-sync env import', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('env-import');
    await env.setup();
    env.execCommand('init --no-interactive');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should import env vars from a .env file', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'SECRET=abc123\nPORT=3000\n');

    const result = env.execCommand(`env import my-app ${envFile} --no-sync`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Imported 2 env vars');
    expect(result.stdout).toContain('my-app');
  });

  it('should create env-vars.age (encrypted)', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'KEY=value\n');

    env.execCommand(`env import my-app ${envFile} --no-sync`);

    const ageFile = path.join(env.syncDir, 'env-vars.age');
    expect(fs.existsSync(ageFile)).toBe(true);

    const raw = fs.readFileSync(ageFile, 'utf-8');
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
  });

  it('should NOT create env-vars.json', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'KEY=value\n');

    env.execCommand(`env import my-app ${envFile} --no-sync`);

    expect(fs.existsSync(path.join(env.syncDir, 'env-vars.json'))).toBe(false);
  });

  it('env-vars.age should not contain plaintext secrets', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'STRIPE_KEY=sk_live_abc123\nDB_URL=postgres://user:pass@host/db\n');

    env.execCommand(`env import my-app ${envFile} --no-sync`);

    const raw = fs.readFileSync(path.join(env.syncDir, 'env-vars.age'), 'utf-8');
    expect(raw).not.toContain('sk_live_abc123');
    expect(raw).not.toContain('postgres://');
    expect(raw).not.toContain('STRIPE_KEY');
    expect(raw).not.toContain('my-app');
  });

  it('should show encrypt-by-default message', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'KEY=value\n');

    const result = env.execCommand(`env import my-app ${envFile} --no-sync`);

    expect(result.stdout).toContain('encrypted');
    expect(result.stdout).toContain('encrypt-by-default');
  });

  it('should not display secret values in output', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'STRIPE_KEY=sk_live_abc123\n');

    const result = env.execCommand(`env import my-app ${envFile} --no-sync`);

    expect(result.stdout).not.toContain('sk_live_abc123');
  });

  it('should import from stdin via pipe', () => {
    const result = env.execCommand('env import my-app --stdin --no-sync', {
      stdin: 'SECRET=piped-value\nPORT=8080\n',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Imported 2 env vars');
  });

  it('should fail with missing file', () => {
    const result = env.execCommand('env import my-app /nonexistent/file.env --no-sync');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not found');
  });

  it('should fail with empty .env file', () => {
    const envFile = path.join(env.homeDir, 'empty.env');
    fs.writeFileSync(envFile, '');

    const result = env.execCommand(`env import my-app ${envFile} --no-sync`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No environment variables found');
  });

  it('original .env file is NOT modified after import', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    const content = 'SECRET=abc\nPORT=3000\n';
    fs.writeFileSync(envFile, content);

    env.execCommand(`env import my-app ${envFile} --no-sync`);

    expect(fs.readFileSync(envFile, 'utf-8')).toBe(content);
  });
});

describe('E2E: ctx-sync env add', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('env-add');
    await env.setup();
    env.execCommand('init --no-interactive');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should add a key via --stdin', () => {
    const result = env.execCommand('env add my-app SECRET --stdin --no-sync', {
      stdin: 'my-secret-value',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Added SECRET');
    expect(result.stdout).toContain('Encrypted');
  });

  it('should NOT display the secret value in output', () => {
    const result = env.execCommand('env add my-app SECRET --stdin --no-sync', {
      stdin: 'my-secret-value',
    });

    expect(result.stdout).not.toContain('my-secret-value');
  });

  it('should reject KEY=value syntax (security)', () => {
    const result = env.execCommand('env add my-app STRIPE_KEY=sk_live_123 --stdin --no-sync', {
      stdin: '',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Cannot pass secret values as CLI arguments');
  });

  it('should mention shell history in rejection error', () => {
    const result = env.execCommand('env add my-app KEY=value --stdin --no-sync', {
      stdin: '',
    });

    expect(result.stderr).toContain('shell history');
  });

  it('added var should be retrievable via env list', () => {
    env.execCommand('env add my-app MYKEY --stdin --no-sync', {
      stdin: 'myvalue',
    });

    const listResult = env.execCommand('env list my-app --show-values');

    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain('MYKEY');
    expect(listResult.stdout).toContain('myvalue');
  });
});

describe('E2E: ctx-sync env list', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('env-list');
    await env.setup();
    env.execCommand('init --no-interactive');
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should show "No environment variables" when project has none', () => {
    const result = env.execCommand('env list my-app');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No environment variables');
  });

  it('should list key names after import', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'SECRET_KEY=hidden\nAPI_URL=https://api.example.com\n');
    env.execCommand(`env import my-app ${envFile} --no-sync`);

    const result = env.execCommand('env list my-app');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('SECRET_KEY');
    expect(result.stdout).toContain('API_URL');
  });

  it('should hide values by default', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'SECRET=supersecret\n');
    env.execCommand(`env import my-app ${envFile} --no-sync`);

    const result = env.execCommand('env list my-app');

    expect(result.stdout).toContain('********');
    expect(result.stdout).not.toContain('supersecret');
  });

  it('should show values with --show-values flag', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'SECRET=supersecret\n');
    env.execCommand(`env import my-app ${envFile} --no-sync`);

    const result = env.execCommand('env list my-app --show-values');

    expect(result.stdout).toContain('supersecret');
  });

  it('should show warning when --show-values is used', () => {
    const envFile = path.join(env.homeDir, 'test.env');
    fs.writeFileSync(envFile, 'SECRET=val\n');
    env.execCommand(`env import my-app ${envFile} --no-sync`);

    const result = env.execCommand('env list my-app --show-values');

    expect(result.stdout).toContain('careful');
  });

  it('should suggest env import when no vars exist', () => {
    const result = env.execCommand('env list my-app');

    expect(result.stdout).toContain('env import');
  });
});
