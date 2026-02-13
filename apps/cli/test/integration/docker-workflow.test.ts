/**
 * Integration tests for Docker state workflow.
 *
 * Tests the full cycle: detect compose file → parse → save encrypted
 * state → load back → verify encryption on disk.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey } = await import('../../src/core/encryption.js');
const {
  detectDockerCompose,
  parseComposeFile,
  buildDockerStateEntry,
  saveDockerState,
  loadDockerState,
  loadAllDockerState,
  removeDockerState,
} = await import('../../src/core/docker-handler.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────

const FULL_COMPOSE = `
version: '3.8'

services:
  postgres:
    image: postgres:15
    container_name: my-app-db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: my-app-redis
    ports:
      - "6379:6379"

  web:
    image: node:20
    ports:
      - "3000:3000"
    volumes:
      - ./src:/app/src

networks:
  my-app-network:

volumes:
  postgres_data:
`;

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Docker Workflow Integration', () => {
  let testDir: string;
  let syncDir: string;
  let projectDir: string;
  let publicKey: string;
  let privateKey: string;

  beforeEach(async () => {
    testDir = path.join(
      globalThis.TEST_DIR,
      `docker-integ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    syncDir = path.join(testDir, '.context-sync');
    projectDir = path.join(testDir, 'projects', 'my-app');

    fs.mkdirSync(syncDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    const keys = await generateKey();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
  });

  it('should complete full Docker state lifecycle: detect → parse → save → load', async () => {
    // Write compose file
    fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), FULL_COMPOSE);

    // 1. Detect
    const detection = detectDockerCompose(projectDir);
    expect(detection.found).toBe(true);

    // 2. Parse
    const parsed = parseComposeFile(detection.filePath!);
    expect(parsed.services).toHaveLength(3);

    // 3. Build state entry
    const entry = buildDockerStateEntry('my-app', projectDir);
    expect(entry).not.toBeNull();
    expect(entry!.services).toHaveLength(3);

    // 4. Save encrypted
    await saveDockerState(syncDir, 'my-app', entry!, publicKey, privateKey);

    // 5. Verify encrypted on disk
    const raw = fs.readFileSync(path.join(syncDir, 'docker-state.age'), 'utf-8');
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).not.toContain('postgres');
    expect(raw).not.toContain('my-app');
    expect(raw).not.toContain('docker-compose.yml');
    expect(raw).not.toContain('redis');

    // 6. Load back and verify data matches
    const loaded = await loadDockerState(syncDir, 'my-app', privateKey);
    expect(loaded).not.toBeNull();
    expect(loaded!.services).toHaveLength(3);

    const postgres = loaded!.services.find((s) => s.name === 'postgres');
    expect(postgres).toBeDefined();
    expect(postgres!.image).toBe('postgres:15');
    expect(postgres!.port).toBe(5432);
    expect(postgres!.autoStart).toBe(true);
    expect(postgres!.healthCheck).toBe('pg_isready');

    const redis = loaded!.services.find((s) => s.name === 'redis');
    expect(redis).toBeDefined();
    expect(redis!.image).toBe('redis:7-alpine');
    expect(redis!.port).toBe(6379);

    const web = loaded!.services.find((s) => s.name === 'web');
    expect(web).toBeDefined();
    expect(web!.image).toBe('node:20');
    expect(web!.port).toBe(3000);
  });

  it('should handle multiple projects in Docker state', async () => {
    // Create two project directories with compose files
    const projectDir2 = path.join(testDir, 'projects', 'api-server');
    fs.mkdirSync(projectDir2, { recursive: true });

    fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), FULL_COMPOSE);
    fs.writeFileSync(
      path.join(projectDir2, 'compose.yml'),
      `
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
`,
    );

    // Save both
    const entry1 = buildDockerStateEntry('my-app', projectDir)!;
    const entry2 = buildDockerStateEntry('api-server', projectDir2)!;

    await saveDockerState(syncDir, 'my-app', entry1, publicKey, privateKey);
    await saveDockerState(syncDir, 'api-server', entry2, publicKey, privateKey);

    // Load all
    const all = await loadAllDockerState(syncDir, privateKey);
    expect(all).not.toBeNull();
    expect(Object.keys(all!)).toHaveLength(2);
    expect(all!['my-app']!.services).toHaveLength(3);
    expect(all!['api-server']!.services).toHaveLength(1);
    expect(all!['api-server']!.services[0]!.name).toBe('mongo');

    // Load individually
    const app1 = await loadDockerState(syncDir, 'my-app', privateKey);
    expect(app1!.services).toHaveLength(3);

    const app2 = await loadDockerState(syncDir, 'api-server', privateKey);
    expect(app2!.services).toHaveLength(1);
  });

  it('should fail decryption with wrong key', async () => {
    fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), FULL_COMPOSE);

    const entry = buildDockerStateEntry('my-app', projectDir)!;
    await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);

    // Try with a different key
    const { privateKey: wrongKey } = await generateKey();
    await expect(loadDockerState(syncDir, 'my-app', wrongKey)).rejects.toThrow();
  });

  it('should remove Docker state for a project', async () => {
    fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), FULL_COMPOSE);

    const entry = buildDockerStateEntry('my-app', projectDir)!;
    await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);

    // Verify it exists
    const before = await loadDockerState(syncDir, 'my-app', privateKey);
    expect(before).not.toBeNull();

    // Remove it
    const removed = await removeDockerState(syncDir, 'my-app', publicKey, privateKey);
    expect(removed).toBe(true);

    // Verify it's gone
    const after = await loadDockerState(syncDir, 'my-app', privateKey);
    expect(after).toBeNull();
  });

  it('should not contain any plaintext in docker-state.age', async () => {
    fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), FULL_COMPOSE);

    const entry = buildDockerStateEntry('my-app', projectDir)!;
    await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);

    const raw = fs.readFileSync(path.join(syncDir, 'docker-state.age'), 'utf-8');

    // No service names
    expect(raw).not.toContain('postgres');
    expect(raw).not.toContain('redis');
    expect(raw).not.toContain('web');

    // No image names
    expect(raw).not.toContain('postgres:15');
    expect(raw).not.toContain('redis:7-alpine');
    expect(raw).not.toContain('node:20');

    // No project info
    expect(raw).not.toContain('my-app');
    expect(raw).not.toContain('docker-compose');
    expect(raw).not.toContain('composeFile');

    // No ports
    expect(raw).not.toContain('5432');
    expect(raw).not.toContain('6379');

    // Must be encrypted
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).toContain('-----END AGE ENCRYPTED FILE-----');
  });

  it('should preserve healthcheck information through encrypt/decrypt cycle', async () => {
    fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), FULL_COMPOSE);

    const entry = buildDockerStateEntry('my-app', projectDir)!;
    await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);

    const loaded = await loadDockerState(syncDir, 'my-app', privateKey);
    const postgres = loaded!.services.find((s) => s.name === 'postgres');
    expect(postgres!.healthCheck).toBe('pg_isready');
  });
});
