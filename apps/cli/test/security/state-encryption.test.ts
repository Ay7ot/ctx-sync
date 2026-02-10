import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateKey, encryptState } from '../../src/core/encryption.js';

describe('Security: State Encryption', () => {
  let publicKey: string;
  let _privateKey: string;

  beforeAll(async () => {
    const keys = await generateKey();
    publicKey = keys.publicKey;
    _privateKey = keys.privateKey;
  });

  it('should have no JSON structure visible after encryptState', async () => {
    const state = {
      machine: { id: 'macbook-pro', hostname: 'johns-mbp.local' },
      projects: [
        {
          id: 'my-app',
          name: 'my-app',
          path: '~/projects/my-app',
          git: { branch: 'feature/payments', remote: 'origin', hasUncommitted: true, stashCount: 2 },
          lastAccessed: '2025-02-10T14:30:00Z',
        },
      ],
    };

    const encrypted = await encryptState(state, publicKey);

    // No JSON keys
    expect(encrypted).not.toContain('"machine"');
    expect(encrypted).not.toContain('"projects"');
    expect(encrypted).not.toContain('"hostname"');
    expect(encrypted).not.toContain('"branch"');
    // No values
    expect(encrypted).not.toContain('macbook-pro');
    expect(encrypted).not.toContain('johns-mbp.local');
    expect(encrypted).not.toContain('my-app');
    expect(encrypted).not.toContain('feature/payments');
    // Must be a valid Age file
    expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(encrypted).toContain('-----END AGE ENCRYPTED FILE-----');
  });

  it('should produce only ciphertext when .age file is written and read back', async () => {
    const state = {
      'my-app': {
        STRIPE_KEY: { value: 'sk_live_abc123' },
        DATABASE_URL: { value: 'postgres://user:pass@localhost/db' },
      },
    };

    const encrypted = await encryptState(state, publicKey);

    // Write to disk as .age file
    const agePath = path.join(globalThis.TEST_DIR, 'test-state.age');
    fs.writeFileSync(agePath, encrypted, 'utf-8');

    // Read it back
    const onDisk = fs.readFileSync(agePath, 'utf-8');

    // Must be Age ciphertext only
    expect(onDisk).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    // No secret values
    expect(onDisk).not.toContain('sk_live_abc123');
    expect(onDisk).not.toContain('postgres://');
    expect(onDisk).not.toContain('user:pass');
    // No key names or project names
    expect(onDisk).not.toContain('STRIPE_KEY');
    expect(onDisk).not.toContain('DATABASE_URL');
    expect(onDisk).not.toContain('my-app');
  });

  it('should encrypt all state file types with no plaintext leakage', async () => {
    const stateFiles: Record<string, unknown> = {
      state: {
        machine: { id: 'laptop', hostname: 'dev.local' },
        projects: [{ name: 'test-project', path: '~/projects/test' }],
      },
      'env-vars': {
        'test-project': {
          SECRET_KEY: { value: 'supersecret123', addedAt: '2025-01-01T00:00:00Z' },
        },
      },
      'docker-state': {
        'test-project': {
          services: [{ name: 'postgres', image: 'postgres:15', port: 5432 }],
        },
      },
      'mental-context': {
        'test-project': {
          currentTask: 'Implementing auth flow',
          blockers: [{ description: 'Waiting on API keys' }],
        },
      },
      services: {
        services: [{ name: 'dev-server', port: 3000, command: 'npm run dev' }],
      },
      directories: {
        recentDirs: [{ path: '~/projects/test', frequency: 10 }],
        pinnedDirs: ['~/projects/test'],
      },
    };

    for (const [name, data] of Object.entries(stateFiles)) {
      const encrypted = await encryptState(data, publicKey);

      // Write .age file
      const agePath = path.join(globalThis.TEST_DIR, `${name}.age`);
      fs.writeFileSync(agePath, encrypted, 'utf-8');

      // Verify only ciphertext on disk
      const onDisk = fs.readFileSync(agePath, 'utf-8');
      expect(onDisk).toContain('-----BEGIN AGE ENCRYPTED FILE-----');

      // The serialised JSON must not appear
      const jsonString = JSON.stringify(data);
      expect(onDisk).not.toContain(jsonString);

      // Spot-check: no known sensitive strings
      expect(onDisk).not.toContain('test-project');
      expect(onDisk).not.toContain('supersecret123');
      expect(onDisk).not.toContain('Implementing auth flow');
      expect(onDisk).not.toContain('npm run dev');
    }
  });
});
