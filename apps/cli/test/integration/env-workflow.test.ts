/**
 * Integration tests for the env variable workflow.
 *
 * Tests the full flow with real filesystem operations, real encryption,
 * and real Git (no mocks). Verifies that env-vars.age is encrypted and
 * contains no plaintext sensitive data.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// Import modules under test (no mocks — real operations)
const { executeInit } = await import('../../src/commands/init.js');
const { loadKey } = await import('../../src/core/key-store.js');
const { identityToRecipient } = await import('age-encryption');
const {
  importEnvVars,
  addEnvVar,
  listEnvVars,
  parseEnvFile,
} = await import('../../src/core/env-handler.js');

describe('Integration: Env Variable Workflow', () => {
  let testHome: string;
  let syncDir: string;
  let configDir: string;
  let privateKey: string;
  let publicKey: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    testHome = path.join(globalThis.TEST_DIR, `env-integ-${Date.now()}`);
    fs.mkdirSync(testHome, { recursive: true });

    originalEnv = process.env['CTX_SYNC_HOME'];
    process.env['CTX_SYNC_HOME'] = testHome;

    // Init ctx-sync (creates keys, sync dir, manifest)
    await executeInit({ noInteractive: true });

    syncDir = path.join(testHome, '.context-sync');
    configDir = path.join(testHome, '.config', 'ctx-sync');
    privateKey = loadKey(configDir);
    publicKey = await identityToRecipient(privateKey);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['CTX_SYNC_HOME'];
    } else {
      process.env['CTX_SYNC_HOME'] = originalEnv;
    }
  });

  it('should create env-vars.age after importing env vars', async () => {
    await importEnvVars(
      'my-app',
      [{ key: 'SECRET', value: 'my-secret' }],
      syncDir,
      publicKey,
      privateKey,
    );

    expect(fs.existsSync(path.join(syncDir, 'env-vars.age'))).toBe(true);
  });

  it('should NOT create env-vars.json (plaintext)', async () => {
    await importEnvVars(
      'my-app',
      [{ key: 'SECRET', value: 'val' }],
      syncDir,
      publicKey,
      privateKey,
    );

    expect(fs.existsSync(path.join(syncDir, 'env-vars.json'))).toBe(false);
  });

  it('should encrypt env-vars.age so no plaintext values appear', async () => {
    await importEnvVars(
      'my-app',
      [
        { key: 'STRIPE_KEY', value: 'sk_live_abc123' },
        { key: 'NODE_ENV', value: 'development' },
        { key: 'DATABASE_URL', value: 'postgres://user:pass@localhost/db' },
      ],
      syncDir,
      publicKey,
      privateKey,
    );

    const raw = fs.readFileSync(path.join(syncDir, 'env-vars.age'), 'utf-8');

    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).not.toContain('sk_live_abc123');
    expect(raw).not.toContain('development');
    expect(raw).not.toContain('postgres://');
    expect(raw).not.toContain('STRIPE_KEY');
    expect(raw).not.toContain('NODE_ENV');
    expect(raw).not.toContain('my-app');
  });

  it('should round-trip: import then list produces correct values', async () => {
    const vars = [
      { key: 'KEY1', value: 'value1' },
      { key: 'KEY2', value: 'value with spaces' },
      { key: 'KEY3', value: 'special!@#$%^&*()' },
    ];

    await importEnvVars('my-app', vars, syncDir, publicKey, privateKey);
    const listed = await listEnvVars('my-app', syncDir, privateKey, true);

    expect(listed).toHaveLength(3);
    expect(listed.find((v) => v.key === 'KEY1')?.value).toBe('value1');
    expect(listed.find((v) => v.key === 'KEY2')?.value).toBe('value with spaces');
    expect(listed.find((v) => v.key === 'KEY3')?.value).toBe('special!@#$%^&*()');
  });

  it('should import from a real .env file parsed content', async () => {
    const envContent = [
      '# Database config',
      'DATABASE_URL=postgres://user:pass@localhost:5432/mydb',
      'REDIS_URL=redis://localhost:6379',
      '',
      '# App config',
      'NODE_ENV=development',
      'PORT=3000',
      'SECRET_KEY=super-secret-value-123',
    ].join('\n');

    const parsed = parseEnvFile(envContent);
    expect(parsed).toHaveLength(5);

    await importEnvVars('my-app', parsed, syncDir, publicKey, privateKey);
    const listed = await listEnvVars('my-app', syncDir, privateKey, true);

    expect(listed).toHaveLength(5);
    expect(listed.find((v) => v.key === 'DATABASE_URL')?.value).toBe(
      'postgres://user:pass@localhost:5432/mydb',
    );
    expect(listed.find((v) => v.key === 'SECRET_KEY')?.value).toBe(
      'super-secret-value-123',
    );
  });

  it('should add a single env var to existing state', async () => {
    await importEnvVars(
      'my-app',
      [{ key: 'EXISTING', value: 'existing-val' }],
      syncDir,
      publicKey,
      privateKey,
    );

    await addEnvVar('my-app', 'NEW_KEY', 'new-val', syncDir, publicKey, privateKey);

    const listed = await listEnvVars('my-app', syncDir, privateKey, true);
    expect(listed).toHaveLength(2);
    expect(listed.find((v) => v.key === 'EXISTING')?.value).toBe('existing-val');
    expect(listed.find((v) => v.key === 'NEW_KEY')?.value).toBe('new-val');
  });

  it('should update manifest.json with env-vars.age entry', async () => {
    await importEnvVars(
      'my-app',
      [{ key: 'KEY', value: 'val' }],
      syncDir,
      publicKey,
      privateKey,
    );

    const manifest = JSON.parse(
      fs.readFileSync(path.join(syncDir, 'manifest.json'), 'utf-8'),
    );

    expect(manifest.files['env-vars.age']).toBeDefined();
    expect(manifest.files['env-vars.age'].lastModified).toBeDefined();
  });

  it('should handle multiple projects independently', async () => {
    await importEnvVars(
      'app-a',
      [{ key: 'A_KEY', value: 'a-value' }],
      syncDir,
      publicKey,
      privateKey,
    );
    await importEnvVars(
      'app-b',
      [{ key: 'B_KEY', value: 'b-value' }],
      syncDir,
      publicKey,
      privateKey,
    );

    const varsA = await listEnvVars('app-a', syncDir, privateKey, true);
    const varsB = await listEnvVars('app-b', syncDir, privateKey, true);

    expect(varsA).toHaveLength(1);
    expect(varsA[0]?.key).toBe('A_KEY');
    expect(varsB).toHaveLength(1);
    expect(varsB[0]?.key).toBe('B_KEY');
  });

  it('should overwrite existing vars on re-import', async () => {
    await importEnvVars(
      'my-app',
      [{ key: 'KEY', value: 'original' }],
      syncDir,
      publicKey,
      privateKey,
    );
    await importEnvVars(
      'my-app',
      [{ key: 'KEY', value: 'updated' }],
      syncDir,
      publicKey,
      privateKey,
    );

    const listed = await listEnvVars('my-app', syncDir, privateKey, true);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.value).toBe('updated');
  });

  it('original .env file is NOT modified or deleted after import', async () => {
    // Create a real .env file
    const envFilePath = path.join(testHome, 'test.env');
    const originalContent = 'SECRET=my-secret\nPORT=3000\n';
    fs.writeFileSync(envFilePath, originalContent);

    const parsed = parseEnvFile(originalContent);
    await importEnvVars('my-app', parsed, syncDir, publicKey, privateKey);

    // Verify original file is untouched
    expect(fs.existsSync(envFilePath)).toBe(true);
    expect(fs.readFileSync(envFilePath, 'utf-8')).toBe(originalContent);
  });
});
