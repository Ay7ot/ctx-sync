import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// Import modules under test (top-level await, same pattern as other tests)
const { generateKey } = await import('../../src/core/encryption.js');
const {
  readState,
  writeState,
  readManifest,
  writeManifest,
  listStateFiles,
  stateFileExists,
} = await import('../../src/core/state-manager.js');
const { STATE_FILES } = await import('@ctx-sync/shared');

describe('State Manager Module', () => {
  let publicKey: string;
  let privateKey: string;
  let stateDir: string;

  beforeAll(async () => {
    const keys = await generateKey();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
  });

  beforeEach(() => {
    stateDir = path.join(globalThis.TEST_DIR, 'state-test-' + Date.now());
    fs.mkdirSync(stateDir, { recursive: true });
  });

  describe('writeState()', () => {
    it('should produce an .age file, not a .json file', async () => {
      const state = {
        machine: { id: 'test-machine', hostname: 'test.local' },
        projects: [],
      };

      await writeState(stateDir, state, publicKey, 'state');

      // .age file should exist
      expect(fs.existsSync(path.join(stateDir, STATE_FILES.STATE))).toBe(true);
      // No .json state file should exist
      expect(fs.existsSync(path.join(stateDir, 'state.json'))).toBe(false);
    });

    it('should write encrypted content, not plaintext JSON', async () => {
      const state = {
        machine: { id: 'test-machine', hostname: 'test.local' },
        projects: [
          {
            id: 'my-app',
            name: 'my-app',
            path: '~/projects/my-app',
            git: { branch: 'main', remote: 'origin', hasUncommitted: false, stashCount: 0 },
            lastAccessed: new Date().toISOString(),
          },
        ],
      };

      await writeState(stateDir, state, publicKey, 'state');

      const content = fs.readFileSync(path.join(stateDir, STATE_FILES.STATE), 'utf-8');
      expect(content).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(content).not.toContain('test-machine');
      expect(content).not.toContain('my-app');
      expect(content).not.toContain('"projects"');
    });

    it('should update the manifest when writing state', async () => {
      const state = {
        machine: { id: 'test-machine', hostname: 'test.local' },
        projects: [],
      };

      await writeState(stateDir, state, publicKey, 'state');

      const manifest = readManifest(stateDir);
      expect(manifest).not.toBeNull();
      expect(manifest!.files[STATE_FILES.STATE]).toBeDefined();
      expect(manifest!.files[STATE_FILES.STATE]!.lastModified).toBeDefined();
    });

    it('should create the directory if it does not exist', async () => {
      const newDir = path.join(stateDir, 'nested', 'dir');
      const state = {
        machine: { id: 'test', hostname: 'test' },
        projects: [],
      };

      await writeState(newDir, state, publicKey, 'state');
      expect(fs.existsSync(path.join(newDir, STATE_FILES.STATE))).toBe(true);
    });

    it('should write env-vars as .age file', async () => {
      const envVars = {
        'my-app': {
          STRIPE_KEY: { value: 'sk_live_abc123', addedAt: new Date().toISOString() },
          NODE_ENV: { value: 'development', addedAt: new Date().toISOString() },
        },
      };

      await writeState(stateDir, envVars, publicKey, 'env-vars');

      expect(fs.existsSync(path.join(stateDir, STATE_FILES.ENV_VARS))).toBe(true);
      expect(fs.existsSync(path.join(stateDir, 'env-vars.json'))).toBe(false);

      const content = fs.readFileSync(path.join(stateDir, STATE_FILES.ENV_VARS), 'utf-8');
      expect(content).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(content).not.toContain('sk_live_abc123');
    });

    it('should write all state file types as .age files', async () => {
      await writeState(stateDir, { machine: { id: 't', hostname: 't' }, projects: [] }, publicKey, 'state');
      await writeState(stateDir, { app: { KEY: { value: 'val', addedAt: new Date().toISOString() } } }, publicKey, 'env-vars');
      await writeState(stateDir, { app: { composeFile: 'docker-compose.yml', services: [] } }, publicKey, 'docker-state');
      await writeState(stateDir, { app: { currentTask: 'testing', blockers: [], nextSteps: [], relatedLinks: [], breadcrumbs: [] } }, publicKey, 'mental-context');
      await writeState(stateDir, { services: [] }, publicKey, 'services');
      await writeState(stateDir, { recentDirs: [], pinnedDirs: [] }, publicKey, 'directories');

      // Verify all .age files exist
      expect(fs.existsSync(path.join(stateDir, STATE_FILES.STATE))).toBe(true);
      expect(fs.existsSync(path.join(stateDir, STATE_FILES.ENV_VARS))).toBe(true);
      expect(fs.existsSync(path.join(stateDir, STATE_FILES.DOCKER_STATE))).toBe(true);
      expect(fs.existsSync(path.join(stateDir, STATE_FILES.MENTAL_CONTEXT))).toBe(true);
      expect(fs.existsSync(path.join(stateDir, STATE_FILES.SERVICES))).toBe(true);
      expect(fs.existsSync(path.join(stateDir, STATE_FILES.DIRECTORIES))).toBe(true);
    });
  });

  describe('readState()', () => {
    it('should decrypt and parse state correctly', async () => {
      const state = {
        machine: { id: 'test-machine', hostname: 'test.local' },
        projects: [
          {
            id: 'my-app',
            name: 'my-app',
            path: '~/projects/my-app',
            git: { branch: 'main', remote: 'origin', hasUncommitted: false, stashCount: 0 },
            lastAccessed: '2025-02-10T14:30:00Z',
          },
        ],
      };

      await writeState(stateDir, state, publicKey, 'state');

      const result = await readState(stateDir, privateKey, 'state') as {
        machine: { id: string; hostname: string };
        projects: Array<{ name: string; git: { branch: string } }>;
      };
      expect(result).not.toBeNull();
      expect(result!.machine.id).toBe('test-machine');
      expect(result!.machine.hostname).toBe('test.local');
      expect(result!.projects).toHaveLength(1);
      expect(result!.projects[0]!.name).toBe('my-app');
      expect(result!.projects[0]!.git.branch).toBe('main');
    });

    it('should return null if the file does not exist', async () => {
      const result = await readState(stateDir, privateKey, 'state');
      expect(result).toBeNull();
    });

    it('should return null for empty files', async () => {
      fs.writeFileSync(path.join(stateDir, STATE_FILES.STATE), '', 'utf-8');
      const result = await readState(stateDir, privateKey, 'state');
      expect(result).toBeNull();
    });

    it('should throw on corrupted ciphertext', async () => {
      fs.writeFileSync(path.join(stateDir, STATE_FILES.STATE), 'not-a-valid-age-file', 'utf-8');
      await expect(readState(stateDir, privateKey, 'state')).rejects.toThrow();
    });

    it('should throw with wrong private key', async () => {
      const state = {
        machine: { id: 'test', hostname: 'test' },
        projects: [],
      };

      await writeState(stateDir, state, publicKey, 'state');

      const wrongKeys = await generateKey();
      await expect(
        readState(stateDir, wrongKeys.privateKey, 'state'),
      ).rejects.toThrow();
    });

    it('should round-trip env-vars correctly', async () => {
      const envVars = {
        'my-app': {
          STRIPE_KEY: { value: 'sk_live_abc123', addedAt: '2025-02-10T10:00:00Z' },
          DATABASE_URL: { value: 'postgres://user:pass@localhost/db', addedAt: '2025-02-10T10:00:00Z' },
        },
      };

      await writeState(stateDir, envVars, publicKey, 'env-vars');
      const result = await readState(stateDir, privateKey, 'env-vars') as Record<string, Record<string, { value: string }>>;

      expect(result).not.toBeNull();
      expect(result!['my-app']!['STRIPE_KEY']!.value).toBe('sk_live_abc123');
      expect(result!['my-app']!['DATABASE_URL']!.value).toBe('postgres://user:pass@localhost/db');
    });

    it('should round-trip all state file types', async () => {
      // State file
      const stateData = {
        machine: { id: 'laptop', hostname: 'dev.local' },
        projects: [{ id: 'test', name: 'test', path: '~/test', git: { branch: 'main', remote: 'origin', hasUncommitted: false, stashCount: 0 }, lastAccessed: new Date().toISOString() }],
      };
      await writeState(stateDir, stateData, publicKey, 'state');
      const readStateResult = await readState(stateDir, privateKey, 'state') as { projects: Array<{ name: string }> };
      expect(readStateResult!.projects[0]!.name).toBe('test');

      // Docker state
      const dockerData = {
        'test-project': {
          composeFile: '~/test/docker-compose.yml',
          services: [{ name: 'postgres', container: 'db', image: 'postgres:15', port: 5432, autoStart: true }],
        },
      };
      await writeState(stateDir, dockerData, publicKey, 'docker-state');
      const readDockerResult = await readState(stateDir, privateKey, 'docker-state');
      expect(readDockerResult).not.toBeNull();

      // Services
      const servicesData = { services: [{ project: 'test', name: 'dev', port: 3000, command: 'npm run dev', autoStart: true }] };
      await writeState(stateDir, servicesData, publicKey, 'services');
      const readServicesResult = await readState(stateDir, privateKey, 'services');
      expect(readServicesResult).not.toBeNull();

      // Directories
      const dirData = { recentDirs: [{ path: '~/test', frequency: 5, lastVisit: new Date().toISOString() }], pinnedDirs: ['~/test'] };
      await writeState(stateDir, dirData, publicKey, 'directories');
      const readDirResult = await readState(stateDir, privateKey, 'directories');
      expect(readDirResult).not.toBeNull();
    });
  });

  describe('readManifest()', () => {
    it('should read a valid manifest', () => {
      const manifest = {
        version: '1.0.0',
        lastSync: '2025-02-10T14:30:00Z',
        files: {
          'state.age': { lastModified: '2025-02-10T14:30:00Z' },
        },
      };

      writeManifest(stateDir, manifest);

      const result = readManifest(stateDir);
      expect(result).not.toBeNull();
      expect(result!.version).toBe('1.0.0');
      expect(result!.files['state.age']!.lastModified).toBe('2025-02-10T14:30:00Z');
    });

    it('should return null if manifest does not exist', () => {
      const result = readManifest(stateDir);
      expect(result).toBeNull();
    });

    it('should return null for empty manifest file', () => {
      fs.writeFileSync(path.join(stateDir, STATE_FILES.MANIFEST), '', 'utf-8');
      const result = readManifest(stateDir);
      expect(result).toBeNull();
    });
  });

  describe('writeManifest()', () => {
    it('should write plaintext JSON manifest', () => {
      const manifest = {
        version: '1.0.0',
        lastSync: '2025-02-10T14:30:00Z',
        files: {},
      };

      writeManifest(stateDir, manifest);

      const content = fs.readFileSync(path.join(stateDir, STATE_FILES.MANIFEST), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.lastSync).toBe('2025-02-10T14:30:00Z');
    });

    it('should create the directory if it does not exist', () => {
      const newDir = path.join(stateDir, 'nested', 'manifest-dir');
      const manifest = {
        version: '1.0.0',
        lastSync: new Date().toISOString(),
        files: {},
      };

      writeManifest(newDir, manifest);
      expect(fs.existsSync(path.join(newDir, STATE_FILES.MANIFEST))).toBe(true);
    });
  });

  describe('listStateFiles()', () => {
    it('should list all .age files in the directory', async () => {
      const state = {
        machine: { id: 't', hostname: 't' },
        projects: [],
      };
      await writeState(stateDir, state, publicKey, 'state');

      const envVars = { app: { KEY: { value: 'v', addedAt: new Date().toISOString() } } };
      await writeState(stateDir, envVars, publicKey, 'env-vars');

      const files = listStateFiles(stateDir);
      expect(files).toContain('state.age');
      expect(files).toContain('env-vars.age');
      expect(files).not.toContain('manifest.json');
    });

    it('should return empty array for non-existent directory', () => {
      const files = listStateFiles('/non/existent/path');
      expect(files).toEqual([]);
    });

    it('should return empty array for directory with no .age files', () => {
      const files = listStateFiles(stateDir);
      expect(files).toEqual([]);
    });
  });

  describe('stateFileExists()', () => {
    it('should return true for existing state files', async () => {
      const state = {
        machine: { id: 't', hostname: 't' },
        projects: [],
      };
      await writeState(stateDir, state, publicKey, 'state');

      expect(stateFileExists(stateDir, 'state')).toBe(true);
    });

    it('should return false for non-existing state files', () => {
      expect(stateFileExists(stateDir, 'state')).toBe(false);
      expect(stateFileExists(stateDir, 'env-vars')).toBe(false);
    });
  });

  describe('Security: No plaintext writes', () => {
    it('should never write .json state files to disk', async () => {
      const state = {
        machine: { id: 'test', hostname: 'test' },
        projects: [],
      };

      await writeState(stateDir, state, publicKey, 'state');

      // Verify no .json files (except manifest.json) exist
      const entries = fs.readdirSync(stateDir);
      const jsonFiles = entries.filter((e) => e.endsWith('.json'));
      expect(jsonFiles).toEqual([STATE_FILES.MANIFEST]);
    });

    it('should verify .age file on disk contains only ciphertext', async () => {
      const envVars = {
        'secret-project': {
          AWS_KEY: { value: 'AKIAIOSFODNN7EXAMPLE', addedAt: new Date().toISOString() },
          PASSWORD: { value: 'super-secret-password', addedAt: new Date().toISOString() },
        },
      };

      await writeState(stateDir, envVars, publicKey, 'env-vars');

      const content = fs.readFileSync(path.join(stateDir, STATE_FILES.ENV_VARS), 'utf-8');

      // Must be Age ciphertext
      expect(content).toContain('-----BEGIN AGE ENCRYPTED FILE-----');

      // No plaintext leakage
      expect(content).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(content).not.toContain('super-secret-password');
      expect(content).not.toContain('secret-project');
      expect(content).not.toContain('AWS_KEY');
      expect(content).not.toContain('PASSWORD');
    });

    it('manifest.json should contain only version and timestamps', async () => {
      const state = {
        machine: { id: 'my-laptop', hostname: 'dev-machine.local' },
        projects: [
          {
            id: 'secret-project',
            name: 'secret-project',
            path: '~/projects/secret-project',
            git: { branch: 'main', remote: 'origin', hasUncommitted: false, stashCount: 0 },
            lastAccessed: new Date().toISOString(),
          },
        ],
      };

      await writeState(stateDir, state, publicKey, 'state');

      const manifestContent = fs.readFileSync(path.join(stateDir, STATE_FILES.MANIFEST), 'utf-8');
      expect(manifestContent).not.toContain('secret-project');
      expect(manifestContent).not.toContain('my-laptop');
      expect(manifestContent).not.toContain('dev-machine.local');
      expect(manifestContent).not.toContain('~/projects/');

      const manifest = JSON.parse(manifestContent);
      expect(Object.keys(manifest)).toEqual(
        expect.arrayContaining(['version', 'lastSync', 'files']),
      );
    });
  });
});
