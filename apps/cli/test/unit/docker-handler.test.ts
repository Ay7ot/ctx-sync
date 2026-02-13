import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

// Import module under test
const {
  detectDockerCompose,
  parseComposeContent,
  parseComposeFile,
  parseHostPort,
  buildDockerStateEntry,
  saveDockerState,
  loadDockerState,
  loadAllDockerState,
  removeDockerState,
  COMPOSE_FILE_NAMES,
} = await import('../../src/core/docker-handler.js');

const { generateKey } = await import('../../src/core/encryption.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────

const SAMPLE_COMPOSE = `
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

networks:
  my-app-network:

volumes:
  postgres_data:
`;

const MINIMAL_COMPOSE = `
services:
  web:
    image: node:20
    ports:
      - "3000:3000"
`;

const NO_PORTS_COMPOSE = `
services:
  worker:
    image: my-worker:latest
`;

const COMPLEX_COMPOSE = `
version: "3"

services:
  api:
    image: node:20-alpine
    container_name: api-server
    ports:
      - "0.0.0.0:8080:3000"
    volumes:
      - ./src:/app/src
      - node_modules:/app/node_modules
    healthcheck:
      test: curl -f http://localhost:3000/health || exit 1

  db:
    image: postgres:16
    ports:
      - "5433:5432/tcp"

  cache:
    image: redis:7
    ports:
      - "6380:6379"

networks:
  backend:
  frontend:
`;

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Docker Handler', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(
      globalThis.TEST_DIR,
      `docker-handler-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(testDir, { recursive: true });
  });

  // ─── detectDockerCompose ────────────────────────────────────────────────

  describe('detectDockerCompose()', () => {
    it('should detect docker-compose.yml', () => {
      fs.writeFileSync(path.join(testDir, 'docker-compose.yml'), SAMPLE_COMPOSE);
      const result = detectDockerCompose(testDir);
      expect(result.found).toBe(true);
      expect(result.fileName).toBe('docker-compose.yml');
      expect(result.filePath).toBe(path.join(testDir, 'docker-compose.yml'));
    });

    it('should detect docker-compose.yaml', () => {
      fs.writeFileSync(path.join(testDir, 'docker-compose.yaml'), SAMPLE_COMPOSE);
      const result = detectDockerCompose(testDir);
      expect(result.found).toBe(true);
      expect(result.fileName).toBe('docker-compose.yaml');
    });

    it('should detect compose.yml', () => {
      fs.writeFileSync(path.join(testDir, 'compose.yml'), SAMPLE_COMPOSE);
      const result = detectDockerCompose(testDir);
      expect(result.found).toBe(true);
      expect(result.fileName).toBe('compose.yml');
    });

    it('should detect compose.yaml', () => {
      fs.writeFileSync(path.join(testDir, 'compose.yaml'), SAMPLE_COMPOSE);
      const result = detectDockerCompose(testDir);
      expect(result.found).toBe(true);
      expect(result.fileName).toBe('compose.yaml');
    });

    it('should prefer docker-compose.yml over compose.yml', () => {
      fs.writeFileSync(path.join(testDir, 'docker-compose.yml'), SAMPLE_COMPOSE);
      fs.writeFileSync(path.join(testDir, 'compose.yml'), MINIMAL_COMPOSE);
      const result = detectDockerCompose(testDir);
      expect(result.fileName).toBe('docker-compose.yml');
    });

    it('should return found=false when no compose file exists', () => {
      const result = detectDockerCompose(testDir);
      expect(result.found).toBe(false);
      expect(result.filePath).toBeNull();
      expect(result.fileName).toBeNull();
    });

    it('should return found=false for empty directory', () => {
      const emptyDir = path.join(testDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      const result = detectDockerCompose(emptyDir);
      expect(result.found).toBe(false);
    });
  });

  // ─── parseComposeContent ────────────────────────────────────────────────

  describe('parseComposeContent()', () => {
    it('should parse a standard docker-compose.yml', () => {
      const result = parseComposeContent(SAMPLE_COMPOSE);

      expect(result.services).toHaveLength(2);

      const postgres = result.services.find((s) => s.name === 'postgres');
      expect(postgres).toBeDefined();
      expect(postgres!.image).toBe('postgres:15');
      expect(postgres!.container).toBe('my-app-db');
      expect(postgres!.port).toBe(5432);
      expect(postgres!.volumes).toContain('postgres_data:/var/lib/postgresql/data');
      expect(postgres!.healthCheck).toBe('pg_isready');

      const redis = result.services.find((s) => s.name === 'redis');
      expect(redis).toBeDefined();
      expect(redis!.image).toBe('redis:7-alpine');
      expect(redis!.container).toBe('my-app-redis');
      expect(redis!.port).toBe(6379);
    });

    it('should parse networks', () => {
      const result = parseComposeContent(SAMPLE_COMPOSE);
      expect(result.networks).toContain('my-app-network');
    });

    it('should parse minimal compose file', () => {
      const result = parseComposeContent(MINIMAL_COMPOSE);
      expect(result.services).toHaveLength(1);
      expect(result.services[0]!.name).toBe('web');
      expect(result.services[0]!.image).toBe('node:20');
      expect(result.services[0]!.port).toBe(3000);
    });

    it('should handle services without ports', () => {
      const result = parseComposeContent(NO_PORTS_COMPOSE);
      expect(result.services).toHaveLength(1);
      expect(result.services[0]!.name).toBe('worker');
      expect(result.services[0]!.port).toBe(0);
    });

    it('should parse complex compose file with multi-part ports', () => {
      const result = parseComposeContent(COMPLEX_COMPOSE);
      expect(result.services).toHaveLength(3);

      const api = result.services.find((s) => s.name === 'api');
      expect(api).toBeDefined();
      expect(api!.image).toBe('node:20-alpine');
      expect(api!.container).toBe('api-server');
      expect(api!.port).toBe(8080);
      expect(api!.volumes).toContain('./src:/app/src');
      expect(api!.volumes).toContain('node_modules:/app/node_modules');

      const db = result.services.find((s) => s.name === 'db');
      expect(db).toBeDefined();
      expect(db!.port).toBe(5433);

      const cache = result.services.find((s) => s.name === 'cache');
      expect(cache).toBeDefined();
      expect(cache!.port).toBe(6380);
    });

    it('should parse multiple networks', () => {
      const result = parseComposeContent(COMPLEX_COMPOSE);
      expect(result.networks).toContain('backend');
      expect(result.networks).toContain('frontend');
    });

    it('should handle empty content', () => {
      const result = parseComposeContent('');
      expect(result.services).toHaveLength(0);
      expect(result.networks).toHaveLength(0);
    });

    it('should handle content with only comments', () => {
      const result = parseComposeContent('# This is a comment\n# Another comment');
      expect(result.services).toHaveLength(0);
    });

    it('should handle inline healthcheck', () => {
      const result = parseComposeContent(COMPLEX_COMPOSE);
      const api = result.services.find((s) => s.name === 'api');
      expect(api!.healthCheck).toContain('curl');
    });

    it('should use service name as default container name', () => {
      const result = parseComposeContent(MINIMAL_COMPOSE);
      expect(result.services[0]!.container).toBe('web');
    });
  });

  // ─── parseComposeFile ───────────────────────────────────────────────────

  describe('parseComposeFile()', () => {
    it('should parse a file on disk', () => {
      const filePath = path.join(testDir, 'docker-compose.yml');
      fs.writeFileSync(filePath, SAMPLE_COMPOSE);

      const result = parseComposeFile(filePath);
      expect(result.services).toHaveLength(2);
    });

    it('should throw for non-existent file', () => {
      expect(() => parseComposeFile('/nonexistent/file.yml')).toThrow(
        'Compose file not found',
      );
    });
  });

  // ─── parseHostPort ──────────────────────────────────────────────────────

  describe('parseHostPort()', () => {
    it('should parse simple port mapping "5432:5432"', () => {
      expect(parseHostPort('5432:5432')).toBe(5432);
    });

    it('should parse different host and container ports "8080:80"', () => {
      expect(parseHostPort('8080:80')).toBe(8080);
    });

    it('should parse three-part mapping "0.0.0.0:5432:5432"', () => {
      expect(parseHostPort('0.0.0.0:5432:5432')).toBe(5432);
    });

    it('should handle /tcp suffix', () => {
      expect(parseHostPort('5432:5432/tcp')).toBe(5432);
    });

    it('should handle /udp suffix', () => {
      expect(parseHostPort('5432:5432/udp')).toBe(5432);
    });

    it('should return 0 for empty string', () => {
      expect(parseHostPort('')).toBe(0);
    });

    it('should return 0 for invalid input', () => {
      expect(parseHostPort('not-a-port')).toBe(0);
    });
  });

  // ─── buildDockerStateEntry ──────────────────────────────────────────────

  describe('buildDockerStateEntry()', () => {
    it('should build state entry from compose file', () => {
      fs.writeFileSync(path.join(testDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const entry = buildDockerStateEntry('my-app', testDir);
      expect(entry).not.toBeNull();
      expect(entry!.services).toHaveLength(2);
      expect(entry!.services[0]!.name).toBe('postgres');
      expect(entry!.services[0]!.autoStart).toBe(true);
      expect(entry!.composeFile).toBe(path.join(testDir, 'docker-compose.yml'));
    });

    it('should return null when no compose file exists', () => {
      const entry = buildDockerStateEntry('my-app', testDir);
      expect(entry).toBeNull();
    });

    it('should respect autoStartDefault parameter', () => {
      fs.writeFileSync(path.join(testDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const entry = buildDockerStateEntry('my-app', testDir, false);
      expect(entry).not.toBeNull();
      expect(entry!.services[0]!.autoStart).toBe(false);
    });

    it('should include networks', () => {
      fs.writeFileSync(path.join(testDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const entry = buildDockerStateEntry('my-app', testDir);
      expect(entry!.networks).toContain('my-app-network');
    });

    it('should include volumes on services', () => {
      fs.writeFileSync(path.join(testDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const entry = buildDockerStateEntry('my-app', testDir);
      const postgres = entry!.services.find((s) => s.name === 'postgres');
      expect(postgres!.volumes).toContain('postgres_data:/var/lib/postgresql/data');
    });
  });

  // ─── save/load/remove DockerState ───────────────────────────────────────

  describe('saveDockerState() / loadDockerState() / loadAllDockerState()', () => {
    let syncDir: string;
    let publicKey: string;
    let privateKey: string;

    beforeEach(async () => {
      syncDir = path.join(testDir, '.context-sync');
      fs.mkdirSync(syncDir, { recursive: true });

      const keys = await generateKey();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
    });

    it('should save and load Docker state for a project', async () => {
      const entry = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          {
            name: 'postgres',
            container: 'my-app-db',
            image: 'postgres:15',
            port: 5432,
            autoStart: true,
          },
        ],
      };

      await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);

      const loaded = await loadDockerState(syncDir, 'my-app', privateKey);
      expect(loaded).not.toBeNull();
      expect(loaded!.services).toHaveLength(1);
      expect(loaded!.services[0]!.name).toBe('postgres');
      expect(loaded!.services[0]!.image).toBe('postgres:15');
    });

    it('should return null for non-existent project', async () => {
      const loaded = await loadDockerState(syncDir, 'nonexistent', privateKey);
      expect(loaded).toBeNull();
    });

    it('should merge state for multiple projects', async () => {
      const entry1 = {
        composeFile: '/projects/app1/docker-compose.yml',
        services: [
          { name: 'db', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
        ],
      };
      const entry2 = {
        composeFile: '/projects/app2/docker-compose.yml',
        services: [
          { name: 'cache', container: 'cache', image: 'redis:7', port: 6379, autoStart: true },
        ],
      };

      await saveDockerState(syncDir, 'app1', entry1, publicKey, privateKey);
      await saveDockerState(syncDir, 'app2', entry2, publicKey, privateKey);

      const all = await loadAllDockerState(syncDir, privateKey);
      expect(all).not.toBeNull();
      expect(Object.keys(all!)).toHaveLength(2);
      expect(all!['app1']!.services[0]!.name).toBe('db');
      expect(all!['app2']!.services[0]!.name).toBe('cache');
    });

    it('should encrypt state on disk', async () => {
      const entry = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          { name: 'postgres', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
        ],
      };

      await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);

      const raw = fs.readFileSync(path.join(syncDir, 'docker-state.age'), 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('postgres');
      expect(raw).not.toContain('my-app');
      expect(raw).not.toContain('docker-compose.yml');
    });

    it('should load all Docker state', async () => {
      const entry = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          { name: 'db', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
        ],
      };

      await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);

      const all = await loadAllDockerState(syncDir, privateKey);
      expect(all).not.toBeNull();
      expect(all!['my-app']).toBeDefined();
    });

    it('should return null when no docker-state.age exists', async () => {
      const all = await loadAllDockerState(syncDir, privateKey);
      expect(all).toBeNull();
    });
  });

  describe('removeDockerState()', () => {
    let syncDir: string;
    let publicKey: string;
    let privateKey: string;

    beforeEach(async () => {
      syncDir = path.join(testDir, '.context-sync-remove');
      fs.mkdirSync(syncDir, { recursive: true });

      const keys = await generateKey();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
    });

    it('should remove Docker state for a project', async () => {
      const entry = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          { name: 'db', container: 'db', image: 'postgres:15', port: 5432, autoStart: true },
        ],
      };

      await saveDockerState(syncDir, 'my-app', entry, publicKey, privateKey);
      const removed = await removeDockerState(syncDir, 'my-app', publicKey, privateKey);
      expect(removed).toBe(true);

      const loaded = await loadDockerState(syncDir, 'my-app', privateKey);
      expect(loaded).toBeNull();
    });

    it('should return false for non-existent project', async () => {
      const removed = await removeDockerState(syncDir, 'nonexistent', publicKey, privateKey);
      expect(removed).toBe(false);
    });
  });

  // ─── COMPOSE_FILE_NAMES ─────────────────────────────────────────────────

  describe('COMPOSE_FILE_NAMES', () => {
    it('should include all standard compose file names', () => {
      expect(COMPOSE_FILE_NAMES).toContain('docker-compose.yml');
      expect(COMPOSE_FILE_NAMES).toContain('docker-compose.yaml');
      expect(COMPOSE_FILE_NAMES).toContain('compose.yml');
      expect(COMPOSE_FILE_NAMES).toContain('compose.yaml');
    });
  });
});
