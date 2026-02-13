import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const {
  createService,
  validateService,
  loadServices,
  saveServices,
  addService,
  removeService,
  removeProjectServices,
  loadProjectServices,
  listServiceProjects,
  getAutoStartServices,
} = await import('../../src/core/services-handler.js');

const { generateKey } = await import('../../src/core/encryption.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const syncDir = path.join(
    TEST_DIR,
    `services-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    '.context-sync',
  );
  fs.mkdirSync(syncDir, { recursive: true });
  const { publicKey, privateKey } = await generateKey();
  return { syncDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Services Handler', () => {
  // ── createService() ─────────────────────────────────────────────────

  describe('createService()', () => {
    it('should create a service with default autoStart=false', () => {
      const svc = createService('my-project', 'api', 3000, 'npm start');
      expect(svc.project).toBe('my-project');
      expect(svc.name).toBe('api');
      expect(svc.port).toBe(3000);
      expect(svc.command).toBe('npm start');
      expect(svc.autoStart).toBe(false);
    });

    it('should create a service with autoStart=true', () => {
      const svc = createService('my-project', 'api', 3000, 'npm start', true);
      expect(svc.autoStart).toBe(true);
    });
  });

  // ── validateService() ───────────────────────────────────────────────

  describe('validateService()', () => {
    it('should return no errors for a valid service', () => {
      const svc = createService('proj', 'api', 3000, 'npm start');
      expect(validateService(svc)).toEqual([]);
    });

    it('should reject empty name', () => {
      const svc = createService('proj', '', 3000, 'npm start');
      const errors = validateService(svc);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('name');
    });

    it('should reject empty command', () => {
      const svc = createService('proj', 'api', 3000, '');
      const errors = validateService(svc);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('command'))).toBe(true);
    });

    it('should reject port 0', () => {
      const svc = createService('proj', 'api', 0, 'npm start');
      const errors = validateService(svc);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('Port'))).toBe(true);
    });

    it('should reject port > 65535', () => {
      const svc = createService('proj', 'api', 70000, 'npm start');
      const errors = validateService(svc);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.includes('Port'))).toBe(true);
    });

    it('should reject negative port', () => {
      const svc = createService('proj', 'api', -1, 'npm start');
      const errors = validateService(svc);
      expect(errors.some((e) => e.includes('Port'))).toBe(true);
    });

    it('should reject non-integer port', () => {
      const svc = createService('proj', 'api', 3000.5, 'npm start');
      const errors = validateService(svc);
      expect(errors.some((e) => e.includes('Port'))).toBe(true);
    });

    it('should collect multiple errors', () => {
      const svc = createService('proj', '', 0, '');
      const errors = validateService(svc);
      expect(errors.length).toBe(3);
    });
  });

  // ── save / load round-trip ──────────────────────────────────────────

  describe('saveServices() / loadServices()', () => {
    it('should return empty state when no file exists', async () => {
      const { syncDir, privateKey } = await setupTestEnv();
      const state = await loadServices(syncDir, privateKey);
      expect(state).toEqual({ services: [] });
    });

    it('should save and load services round-trip', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      const svc1 = createService('proj-a', 'api', 3000, 'npm start', true);
      const svc2 = createService('proj-a', 'worker', 4000, 'npm run worker');

      await saveServices(syncDir, { services: [svc1, svc2] }, publicKey);

      const loaded = await loadServices(syncDir, privateKey);
      expect(loaded.services).toHaveLength(2);
      expect(loaded.services[0]).toEqual(svc1);
      expect(loaded.services[1]).toEqual(svc2);
    });

    it('should encrypt on disk (no plaintext)', async () => {
      const { syncDir, publicKey } = await setupTestEnv();
      const svc = createService('proj', 'api', 3000, 'npm start');
      await saveServices(syncDir, { services: [svc] }, publicKey);

      const filePath = path.join(syncDir, 'services.age');
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, 'utf-8');
      expect(raw).not.toContain('npm start');
      expect(raw).not.toContain('proj');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    });
  });

  // ── addService() ────────────────────────────────────────────────────

  describe('addService()', () => {
    it('should add a service to empty state', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const svc = createService('proj', 'api', 3000, 'npm start');
      await addService(syncDir, svc, publicKey, privateKey);

      const loaded = await loadServices(syncDir, privateKey);
      expect(loaded.services).toHaveLength(1);
      expect(loaded.services[0]).toEqual(svc);
    });

    it('should upsert (replace) existing service with same project+name', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      const svc1 = createService('proj', 'api', 3000, 'npm start');
      await addService(syncDir, svc1, publicKey, privateKey);

      const svc2 = createService('proj', 'api', 8080, 'npm run dev', true);
      await addService(syncDir, svc2, publicKey, privateKey);

      const loaded = await loadServices(syncDir, privateKey);
      expect(loaded.services).toHaveLength(1);
      expect(loaded.services[0]!.port).toBe(8080);
      expect(loaded.services[0]!.command).toBe('npm run dev');
      expect(loaded.services[0]!.autoStart).toBe(true);
    });

    it('should keep services from different projects', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj-a', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj-b', 'api', 4000, 'yarn dev'),
        publicKey,
        privateKey,
      );

      const loaded = await loadServices(syncDir, privateKey);
      expect(loaded.services).toHaveLength(2);
    });
  });

  // ── removeService() ─────────────────────────────────────────────────

  describe('removeService()', () => {
    it('should remove a service and return true', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );

      const removed = await removeService(syncDir, 'proj', 'api', publicKey, privateKey);
      expect(removed).toBe(true);

      const loaded = await loadServices(syncDir, privateKey);
      expect(loaded.services).toHaveLength(0);
    });

    it('should return false when service not found', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const removed = await removeService(syncDir, 'proj', 'missing', publicKey, privateKey);
      expect(removed).toBe(false);
    });
  });

  // ── removeProjectServices() ─────────────────────────────────────────

  describe('removeProjectServices()', () => {
    it('should remove all services for a project', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj-a', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj-a', 'worker', 4000, 'npm run worker'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj-b', 'api', 5000, 'yarn dev'),
        publicKey,
        privateKey,
      );

      const removed = await removeProjectServices(syncDir, 'proj-a', publicKey, privateKey);
      expect(removed).toBe(2);

      const loaded = await loadServices(syncDir, privateKey);
      expect(loaded.services).toHaveLength(1);
      expect(loaded.services[0]!.project).toBe('proj-b');
    });

    it('should return 0 when project has no services', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();
      const removed = await removeProjectServices(syncDir, 'no-such', publicKey, privateKey);
      expect(removed).toBe(0);
    });
  });

  // ── loadProjectServices() ───────────────────────────────────────────

  describe('loadProjectServices()', () => {
    it('should load services for a specific project', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj-a', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj-b', 'api', 4000, 'yarn dev'),
        publicKey,
        privateKey,
      );

      const services = await loadProjectServices(syncDir, privateKey, 'proj-a');
      expect(services).toHaveLength(1);
      expect(services[0]!.project).toBe('proj-a');
    });

    it('should return empty array for unknown project', async () => {
      const { syncDir, privateKey } = await setupTestEnv();
      const services = await loadProjectServices(syncDir, privateKey, 'unknown');
      expect(services).toEqual([]);
    });
  });

  // ── listServiceProjects() ───────────────────────────────────────────

  describe('listServiceProjects()', () => {
    it('should list unique project names sorted', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('zulu', 'api', 3000, 'npm start'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('alpha', 'api', 4000, 'yarn dev'),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('alpha', 'worker', 5000, 'npm run worker'),
        publicKey,
        privateKey,
      );

      const projects = await listServiceProjects(syncDir, privateKey);
      expect(projects).toEqual(['alpha', 'zulu']);
    });

    it('should return empty for no services', async () => {
      const { syncDir, privateKey } = await setupTestEnv();
      const projects = await listServiceProjects(syncDir, privateKey);
      expect(projects).toEqual([]);
    });
  });

  // ── getAutoStartServices() ──────────────────────────────────────────

  describe('getAutoStartServices()', () => {
    it('should only return services with autoStart=true', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start', true),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj', 'worker', 4000, 'npm run worker', false),
        publicKey,
        privateKey,
      );
      await addService(
        syncDir,
        createService('proj', 'db', 5432, 'docker compose up -d postgres', true),
        publicKey,
        privateKey,
      );

      const autoStart = await getAutoStartServices(syncDir, privateKey, 'proj');
      expect(autoStart).toHaveLength(2);
      expect(autoStart.map((s) => s.name).sort()).toEqual(['api', 'db']);
    });

    it('should return empty when no auto-start services', async () => {
      const { syncDir, publicKey, privateKey } = await setupTestEnv();

      await addService(
        syncDir,
        createService('proj', 'api', 3000, 'npm start', false),
        publicKey,
        privateKey,
      );

      const autoStart = await getAutoStartServices(syncDir, privateKey, 'proj');
      expect(autoStart).toHaveLength(0);
    });
  });
});
