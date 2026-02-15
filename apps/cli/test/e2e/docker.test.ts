/**
 * E2E tests for `ctx-sync docker` commands.
 *
 * Uses real CLI invocations via tsx to test docker track/start/stop/status
 * end-to-end.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

const SAMPLE_COMPOSE = `
services:
  postgres:
    image: postgres:15
    container_name: my-app-db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
`;

describe('E2E: ctx-sync docker', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('docker');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  // ─── docker track ──────────────────────────────────────────────────────

  describe('docker track', () => {
    it('should fail before init', () => {
      const projectDir = path.join(env.homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const result = env.execCommand(`docker track --path ${projectDir} --project my-app`);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('No sync repository found');
    });

    it('should track Docker services from compose file', () => {
      env.execCommand('init --no-interactive');

      const projectDir = path.join(env.homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const result = env.execCommand(
        `docker track --path ${projectDir} --project my-app --no-sync`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Docker services tracked');
      expect(result.stdout).toContain('my-app');
      expect(result.stdout).toContain('postgres');
      expect(result.stdout).toContain('redis');
    });

    it('should fail when no compose file exists', () => {
      env.execCommand('init --no-interactive');

      const projectDir = path.join(env.homeDir, 'projects', 'empty');
      fs.mkdirSync(projectDir, { recursive: true });

      const result = env.execCommand(
        `docker track --path ${projectDir} --project empty --no-sync`,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('No Docker Compose file found');
    });

    it('should encrypt Docker state on disk', () => {
      env.execCommand('init --no-interactive');

      const projectDir = path.join(env.homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      env.execCommand(`docker track --path ${projectDir} --project my-app --no-sync`);

      const agePath = path.join(env.syncDir, 'docker-state.age');
      expect(fs.existsSync(agePath)).toBe(true);

      const raw = fs.readFileSync(agePath, 'utf-8');
      expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(raw).not.toContain('postgres');
      expect(raw).not.toContain('my-app');
    });
  });

  // ─── docker status ─────────────────────────────────────────────────────

  describe('docker status', () => {
    it('should show "No Docker services tracked" when empty', () => {
      env.execCommand('init --no-interactive');

      const result = env.execCommand('docker status');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No Docker services tracked');
    });

    it('should show tracked services after docker track', () => {
      env.execCommand('init --no-interactive');

      const projectDir = path.join(env.homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      env.execCommand(`docker track --path ${projectDir} --project my-app --no-sync`);

      const result = env.execCommand('docker status');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('my-app');
      expect(result.stdout).toContain('postgres');
      expect(result.stdout).toContain('redis');
    });

    it('should filter by project name', () => {
      env.execCommand('init --no-interactive');

      const projectDir1 = path.join(env.homeDir, 'projects', 'app1');
      const projectDir2 = path.join(env.homeDir, 'projects', 'app2');
      fs.mkdirSync(projectDir1, { recursive: true });
      fs.mkdirSync(projectDir2, { recursive: true });

      fs.writeFileSync(path.join(projectDir1, 'docker-compose.yml'), SAMPLE_COMPOSE);
      fs.writeFileSync(
        path.join(projectDir2, 'docker-compose.yml'),
        'services:\n  mongo:\n    image: mongo:7\n    ports:\n      - "27017:27017"\n',
      );

      env.execCommand(`docker track --path ${projectDir1} --project app1 --no-sync`);
      env.execCommand(`docker track --path ${projectDir2} --project app2 --no-sync`);

      const result = env.execCommand('docker status app1');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('app1');
      expect(result.stdout).toContain('postgres');
      expect(result.stdout).not.toContain('mongo');
    });
  });

  // ─── docker start ──────────────────────────────────────────────────────

  describe('docker start', () => {
    /** Check if Docker is available on this machine */
    function dockerAvailable(): boolean {
      try {
        execSync('docker info', { stdio: 'pipe', timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }

    it('should show commands or report Docker unavailable in non-interactive mode', () => {
      env.execCommand('init --no-interactive');

      const projectDir = path.join(env.homeDir, 'projects', 'my-app');
      fs.mkdirSync(projectDir, { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      env.execCommand(`docker track --path ${projectDir} --project my-app --no-sync`);

      const result = env.execCommand('docker start my-app --no-interactive');
      const output = result.stdout + result.stderr;

      if (dockerAvailable()) {
        // When Docker is available, commands should be shown but not executed
        expect(output).toContain('Docker');
        expect(output).toContain('Skipped');
      } else {
        // When Docker is not available, should report that
        expect(output).toContain('Docker is not available');
      }
    });

    it('should fail for non-existent project or unavailable Docker', () => {
      env.execCommand('init --no-interactive');

      const result = env.execCommand('docker start nonexistent --no-interactive');

      expect(result.exitCode).not.toBe(0);
      const output = result.stderr + result.stdout;
      // Either Docker is unavailable or no state found
      expect(
        output.includes('No Docker state found') ||
          output.includes('Docker is not available'),
      ).toBe(true);
    });

    it('should accept --path flag for cross-machine usage', () => {
      env.execCommand('init --no-interactive');

      // Track Docker from "Machine A" path
      const machineADir = path.join(env.homeDir, 'machineA', 'my-app');
      fs.mkdirSync(machineADir, { recursive: true });
      fs.writeFileSync(path.join(machineADir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      env.execCommand(`docker track --path ${machineADir} --project my-app --no-sync`);

      // Create "Machine B" path (different location)
      const machineBDir = path.join(env.homeDir, 'machineB', 'code', 'my-app');
      fs.mkdirSync(machineBDir, { recursive: true });
      fs.writeFileSync(path.join(machineBDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      // Start with --path pointing to Machine B
      const result = env.execCommand(`docker start my-app --no-interactive --path ${machineBDir}`);
      const output = result.stdout + result.stderr;

      if (output.includes('Docker is not available')) {
        // Skip assertion if Docker is unavailable
        expect(result.exitCode).not.toBe(0);
      } else {
        // --path was accepted and commands were shown
        expect(output).toContain('Docker');
        expect(output).toContain('Skipped');
      }
    });
  });

  // ─── docker stop ──────────────────────────────────────────────────────

  describe('docker stop', () => {
    it('should accept --path flag for cross-machine usage', () => {
      env.execCommand('init --no-interactive');

      // Track Docker from "Machine A" path
      const machineADir = path.join(env.homeDir, 'machineA', 'my-app');
      fs.mkdirSync(machineADir, { recursive: true });
      fs.writeFileSync(path.join(machineADir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      env.execCommand(`docker track --path ${machineADir} --project my-app --no-sync`);

      // Try to stop with --path pointing to a different location
      const machineBDir = path.join(env.homeDir, 'machineB', 'code', 'my-app');
      fs.mkdirSync(machineBDir, { recursive: true });
      fs.writeFileSync(path.join(machineBDir, 'docker-compose.yml'), SAMPLE_COMPOSE);

      const result = env.execCommand(`docker stop my-app --path ${machineBDir}`);
      const output = result.stdout + result.stderr;

      if (output.includes('Docker is not available')) {
        // Docker not installed — just verify the flag was accepted
        expect(result.exitCode).not.toBe(0);
      } else {
        // Docker is available — it either stopped or failed (both are fine, flag was accepted)
        expect(output).not.toContain('unknown option');
      }
    });

    it('should report missing state for unknown project', () => {
      env.execCommand('init --no-interactive');

      const result = env.execCommand('docker stop nonexistent');
      const output = result.stdout + result.stderr;

      if (output.includes('Docker is not available')) {
        expect(result.exitCode).not.toBe(0);
      } else {
        expect(output).toContain('No Docker state found');
      }
    });
  });
});
