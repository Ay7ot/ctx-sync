/**
 * Integration tests for the mental context workflow.
 *
 * Tests the full cycle: write context → encrypt → read back → verify data
 * integrity, with real encryption and file I/O.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateKey } from '../../src/core/encryption.js';
import { saveKey } from '../../src/core/key-store.js';
import { writeState, readState } from '../../src/core/state-manager.js';
import type { MentalContext } from '@ctx-sync/shared';

declare global {
  var TEST_DIR: string;
}

describe('Integration: Mental Context Workflow', () => {
  let homeDir: string;
  let configDir: string;
  let syncDir: string;
  let privateKey: string;
  let publicKey: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env['CTX_SYNC_HOME'];
    homeDir = path.join(
      globalThis.TEST_DIR,
      `mental-int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
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

  it('should write mental context and read it back correctly', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Implementing Stripe webhook handlers',
        lastWorkingOn: {
          file: 'src/webhooks/stripe.ts',
          line: 45,
          column: 12,
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
          'Add error handling for invalid signatures',
          'Update documentation',
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

    // Write encrypted state
    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // Read back and verify
    const decrypted = await readState<MentalContext>(
      syncDir,
      privateKey,
      'mental-context',
    );

    expect(decrypted).not.toBeNull();
    const ctx = decrypted!['my-app']!;

    expect(ctx.currentTask).toBe('Implementing Stripe webhook handlers');
    expect(ctx.lastWorkingOn?.file).toBe('src/webhooks/stripe.ts');
    expect(ctx.lastWorkingOn?.line).toBe(45);
    expect(ctx.lastWorkingOn?.column).toBe(12);
    expect(ctx.blockers).toHaveLength(1);
    expect(ctx.blockers[0]!.description).toBe(
      'Waiting for staging API keys from ops',
    );
    expect(ctx.blockers[0]!.priority).toBe('high');
    expect(ctx.nextSteps).toHaveLength(3);
    expect(ctx.relatedLinks).toHaveLength(2);
    expect(ctx.breadcrumbs).toHaveLength(2);
  });

  it('should encrypt mental-context.age on disk', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Implementing secret feature',
        blockers: [],
        nextSteps: ['Deploy to production'],
        relatedLinks: [],
        breadcrumbs: [
          { note: 'Internal planning note - confidential', timestamp: new Date().toISOString() },
        ],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    // Verify file on disk is encrypted
    const filePath = path.join(syncDir, 'mental-context.age');
    expect(fs.existsSync(filePath)).toBe(true);

    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).not.toContain('Implementing secret feature');
    expect(raw).not.toContain('Deploy to production');
    expect(raw).not.toContain('confidential');
    expect(raw).not.toContain('my-app');
  });

  it('should handle multiple projects in mental context', async () => {
    const mentalContext: MentalContext = {
      'app-frontend': {
        currentTask: 'Building auth flow',
        blockers: [],
        nextSteps: ['Add login form'],
        relatedLinks: [],
        breadcrumbs: [],
      },
      'app-backend': {
        currentTask: 'Setting up API routes',
        blockers: [
          {
            description: 'Need DB schema review',
            addedAt: new Date().toISOString(),
            priority: 'medium',
          },
        ],
        nextSteps: ['Add CRUD endpoints'],
        relatedLinks: [],
        breadcrumbs: [],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    const decrypted = await readState<MentalContext>(
      syncDir,
      privateKey,
      'mental-context',
    );

    expect(decrypted!['app-frontend']!.currentTask).toBe('Building auth flow');
    expect(decrypted!['app-backend']!.currentTask).toBe(
      'Setting up API routes',
    );
    expect(decrypted!['app-backend']!.blockers).toHaveLength(1);
  });

  it('should update mental context by re-writing full state', async () => {
    // Write initial
    const initial: MentalContext = {
      'my-app': {
        currentTask: 'Initial task',
        blockers: [],
        nextSteps: ['Step 1'],
        relatedLinks: [],
        breadcrumbs: [],
      },
    };

    await writeState(syncDir, initial, publicKey, 'mental-context');

    // Read and update
    const read = await readState<MentalContext>(
      syncDir,
      privateKey,
      'mental-context',
    );
    const ctx = read!['my-app']!;
    ctx.currentTask = 'Updated task';
    ctx.nextSteps.push('Step 2');
    ctx.breadcrumbs.push({
      note: 'Changed approach',
      timestamp: new Date().toISOString(),
    });

    // Write updated
    await writeState(syncDir, read!, publicKey, 'mental-context');

    // Read back and verify
    const updated = await readState<MentalContext>(
      syncDir,
      privateKey,
      'mental-context',
    );

    expect(updated!['my-app']!.currentTask).toBe('Updated task');
    expect(updated!['my-app']!.nextSteps).toHaveLength(2);
    expect(updated!['my-app']!.breadcrumbs).toHaveLength(1);
  });

  it('should fail decryption with wrong key', async () => {
    const mentalContext: MentalContext = {
      'my-app': {
        currentTask: 'Secret work',
        blockers: [],
        nextSteps: [],
        relatedLinks: [],
        breadcrumbs: [],
      },
    };

    await writeState(syncDir, mentalContext, publicKey, 'mental-context');

    const wrongKeys = await generateKey();
    await expect(
      readState<MentalContext>(syncDir, wrongKeys.privateKey, 'mental-context'),
    ).rejects.toThrow();
  });

  it('should return null if mental-context.age does not exist', async () => {
    const result = await readState<MentalContext>(
      syncDir,
      privateKey,
      'mental-context',
    );
    expect(result).toBeNull();
  });

  it('should not write plaintext JSON file', async () => {
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

    // No plaintext JSON file should exist
    const jsonPath = path.join(syncDir, 'mental-context.json');
    expect(fs.existsSync(jsonPath)).toBe(false);
  });
});
