/**
 * Integration tests for the restore workflow.
 *
 * Tests the full cycle: init → track → sync → restore on "new machine"
 * with real encryption, file I/O, and git operations.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateKey } from '../../src/core/encryption.js';
import { saveKey } from '../../src/core/key-store.js';
import { writeState, readState } from '../../src/core/state-manager.js';
import type { StateFile, EnvVars, MentalContext, ServiceState } from '@ctx-sync/shared';

declare global {
  var TEST_DIR: string;
}

describe('Integration: Restore Workflow', () => {
  let homeDir: string;
  let configDir: string;
  let syncDir: string;
  let privateKey: string;
  let publicKey: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env['CTX_SYNC_HOME'];
    homeDir = path.join(globalThis.TEST_DIR, `restore-int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    configDir = path.join(homeDir, '.config', 'ctx-sync');
    syncDir = path.join(homeDir, '.context-sync');

    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });

    const keys = await generateKey();
    privateKey = keys.privateKey;
    publicKey = keys.publicKey;
    saveKey(configDir, privateKey);

    process.env['CTX_SYNC_HOME'] = homeDir;
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env['CTX_SYNC_HOME'] = originalHome;
    } else {
      delete process.env['CTX_SYNC_HOME'];
    }
  });

  it('should complete full cycle: track → write state → restore reads correctly', async () => {
    const projectPath = path.join(homeDir, 'projects', 'my-app');
    fs.mkdirSync(projectPath, { recursive: true });

    const state: StateFile = {
      machine: { id: 'test-machine', hostname: 'test-host' },
      projects: [
        {
          id: 'proj-1',
          name: 'my-app',
          path: projectPath,
          git: { branch: 'feature/payments', remote: 'origin', hasUncommitted: true, stashCount: 2 },
          lastAccessed: new Date().toISOString(),
        },
      ],
    };

    // Write encrypted state
    await writeState(syncDir, state, publicKey, 'state');

    // Verify on disk it's encrypted
    const rawOnDisk = fs.readFileSync(path.join(syncDir, 'state.age'), 'utf-8');
    expect(rawOnDisk).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(rawOnDisk).not.toContain('my-app');
    expect(rawOnDisk).not.toContain('feature/payments');

    // Read it back (simulating restore decryption)
    const decrypted = await readState<StateFile>(syncDir, privateKey, 'state');
    expect(decrypted).not.toBeNull();
    expect(decrypted!.projects[0]!.name).toBe('my-app');
    expect(decrypted!.projects[0]!.git.branch).toBe('feature/payments');
  });

  it('should restore env vars and write .env file correctly', async () => {
    const projectPath = path.join(homeDir, 'projects', 'my-app');
    fs.mkdirSync(projectPath, { recursive: true });

    // Write encrypted env vars
    const envVars: EnvVars = {
      'my-app': {
        'NODE_ENV': { value: 'development', addedAt: new Date().toISOString() },
        'PORT': { value: '3000', addedAt: new Date().toISOString() },
        'STRIPE_KEY': { value: 'sk_test_abc123', addedAt: new Date().toISOString() },
        'DATABASE_URL': { value: 'postgres://user:pass@localhost/db', addedAt: new Date().toISOString() },
      },
    };

    await writeState(syncDir, envVars, publicKey, 'env-vars');

    // Verify env-vars.age does not contain plaintext
    const rawEnv = fs.readFileSync(path.join(syncDir, 'env-vars.age'), 'utf-8');
    expect(rawEnv).not.toContain('sk_test_abc123');
    expect(rawEnv).not.toContain('postgres://user:pass');
    expect(rawEnv).not.toContain('STRIPE_KEY');

    // Decrypt (simulating restore)
    const decrypted = await readState<EnvVars>(syncDir, privateKey, 'env-vars');
    expect(decrypted).not.toBeNull();
    expect(decrypted!['my-app']!['STRIPE_KEY']!.value).toBe('sk_test_abc123');

    // Import writeEnvFile dynamically to avoid top-level import issues
    const { writeEnvFile } = await import('../../src/commands/restore.js');

    // Write .env file
    const written = writeEnvFile(projectPath, decrypted!['my-app']!);
    expect(written).toBe(true);

    // Verify .env file
    const envContent = fs.readFileSync(path.join(projectPath, '.env'), 'utf-8');
    expect(envContent).toContain('NODE_ENV=development');
    expect(envContent).toContain('PORT=3000');
    expect(envContent).toContain('STRIPE_KEY=sk_test_abc123');
    expect(envContent).toContain('DATABASE_URL=');
  });

  it('should restore mental context correctly', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Implementing Stripe webhook handlers',
        lastWorkingOn: {
          file: 'src/webhooks/stripe.ts',
          line: 45,
          description: 'Adding signature verification',
          timestamp: new Date().toISOString(),
        },
        blockers: [
          { description: 'Waiting for staging API keys', addedAt: new Date().toISOString(), priority: 'high' },
        ],
        nextSteps: ['Test webhook with Stripe CLI', 'Add error handling'],
        relatedLinks: [
          { title: 'Stripe Webhooks Docs', url: 'https://stripe.com/docs/webhooks' },
        ],
        breadcrumbs: [
          { note: 'Started at line 23 - added webhook route', timestamp: new Date().toISOString() },
        ],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // Verify encrypted on disk
    const raw = fs.readFileSync(path.join(syncDir, 'mental-context.age'), 'utf-8');
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).not.toContain('Implementing Stripe');

    // Decrypt (restore)
    const decrypted = await readState<MentalContext>(syncDir, privateKey, 'mental-context');
    expect(decrypted!['my-app']!.currentTask).toBe('Implementing Stripe webhook handlers');
    expect(decrypted!['my-app']!.nextSteps).toHaveLength(2);
    expect(decrypted!['my-app']!.breadcrumbs).toHaveLength(1);
  });

  it('should collect restore commands from service state', async () => {
    const serviceState: ServiceState = {
      services: [
        { project: 'my-app', name: 'dev-server', port: 3000, command: 'npm run dev', autoStart: true },
        { project: 'my-app', name: 'test-watcher', port: 0, command: 'npm run test:watch', autoStart: false },
        { project: 'other-project', name: 'other-svc', port: 8080, command: 'npm start', autoStart: true },
      ],
    };

    await writeState(syncDir, serviceState, publicKey, 'services');

    const { collectRestoreCommands } = await import('../../src/commands/restore.js');
    const commands = await collectRestoreCommands('my-app', syncDir, privateKey);

    // Should only include my-app's autoStart services
    expect(commands).toHaveLength(1);
    expect(commands[0]!.command).toBe('npm run dev');
    expect(commands[0]!.port).toBe(3000);
  });

  it('should fail decryption with wrong key', async () => {
    // Write state with correct key
    await writeState(
      syncDir,
      {
        machine: { id: 'test', hostname: 'host' },
        projects: [
          {
            id: 'p1',
            name: 'my-app',
            path: '/app',
            git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
            lastAccessed: new Date().toISOString(),
          },
        ],
      },
      publicKey,
      'state',
    );

    // Try to decrypt with a different key
    const wrongKeys = await generateKey();

    await expect(
      readState<StateFile>(syncDir, wrongKeys.privateKey, 'state'),
    ).rejects.toThrow();
  });

  it('should restore with --path override to a different temp dir', async () => {
    // Simulate "Machine A" tracked the project at machineAPath
    const machineAPath = path.join(homeDir, 'machine-a', 'projects', 'my-app');

    // On "Machine B", the project lives at machineBPath
    const machineBPath = path.join(homeDir, 'machine-b', 'projects', 'my-app');
    fs.mkdirSync(machineBPath, { recursive: true });

    // Write state with Machine A's path (which doesn't exist on Machine B)
    const state: StateFile = {
      machine: { id: 'machine-a', hostname: 'machine-a-host' },
      projects: [
        {
          id: 'proj-1',
          name: 'my-app',
          path: machineAPath,
          git: { branch: 'main', remote: 'origin', hasUncommitted: false, stashCount: 0 },
          lastAccessed: new Date().toISOString(),
        },
      ],
    };
    await writeState(syncDir, state, publicKey, 'state');

    // Write env vars
    const envVars: EnvVars = {
      'my-app': {
        'DATABASE_URL': { value: 'postgres://localhost/mydb', addedAt: new Date().toISOString() },
        'SECRET_KEY': { value: 'sk_test_xyzabc', addedAt: new Date().toISOString() },
      },
    };
    await writeState(syncDir, envVars, publicKey, 'env-vars');

    // Import and use writeEnvFile + resolveLocalPath
    const { writeEnvFile, resolveLocalPath } = await import('../../src/commands/restore.js');

    // Resolve path with --path override (simulating Machine B)
    const { resolvedPath, pathResolved } = resolveLocalPath(machineAPath, { localPath: machineBPath });
    expect(resolvedPath).toBe(machineBPath);
    expect(pathResolved).toBe(true);

    // Machine A's path should NOT exist
    expect(fs.existsSync(machineAPath)).toBe(false);

    // Decrypt env vars and write to Machine B's path
    const decrypted = await readState<EnvVars>(syncDir, privateKey, 'env-vars');
    expect(decrypted).not.toBeNull();

    const written = writeEnvFile(resolvedPath, decrypted!['my-app']!);
    expect(written).toBe(true);

    // Verify .env file was written to Machine B's path
    const envContent = fs.readFileSync(path.join(machineBPath, '.env'), 'utf-8');
    expect(envContent).toContain('DATABASE_URL=');
    expect(envContent).toContain('SECRET_KEY=sk_test_xyzabc');

    // Verify Machine A's path does NOT have a .env file
    expect(fs.existsSync(path.join(machineAPath, '.env'))).toBe(false);
  });

  it('should handle missing env vars gracefully', async () => {
    await writeState(
      syncDir,
      {
        machine: { id: 'test', hostname: 'host' },
        projects: [
          {
            id: 'p1',
            name: 'my-app',
            path: '/nonexistent',
            git: { branch: 'main', remote: '', hasUncommitted: false, stashCount: 0 },
            lastAccessed: new Date().toISOString(),
          },
        ],
      },
      publicKey,
      'state',
    );

    // No env-vars.age file — should still work
    const envVars = await readState<EnvVars>(syncDir, privateKey, 'env-vars');
    expect(envVars).toBeNull();
  });
});
