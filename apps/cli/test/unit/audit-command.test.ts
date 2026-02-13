import * as fs from 'node:fs';
import * as path from 'node:path';

declare global {
  var TEST_DIR: string;
}

const { generateKey } = await import(
  '../../src/core/encryption.js'
);
const { writeState } = await import('../../src/core/state-manager.js');
const {
  checkPermissions,
  checkStateFiles,
  checkRemoteTransport,
  checkRepoSize,
  formatBytes,
  executeAudit,
} = await import('../../src/commands/audit.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

async function setupTestEnv() {
  const testHome = path.join(
    TEST_DIR,
    `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const configDir = path.join(testHome, '.config', 'ctx-sync');
  const syncDir = path.join(testHome, '.context-sync');

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(syncDir, { recursive: true });

  process.env['CTX_SYNC_HOME'] = testHome;

  const { publicKey, privateKey } = await generateKey();
  fs.writeFileSync(path.join(configDir, 'key.txt'), privateKey, {
    mode: 0o600,
  });

  return { testHome, configDir, syncDir, publicKey, privateKey };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('Audit Command', () => {
  // ── checkPermissions() ────────────────────────────────────────────

  describe('checkPermissions()', () => {
    it('should report info when permissions are correct', async () => {
      const { configDir } = await setupTestEnv();

      const findings = checkPermissions(configDir);

      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe('info');
      expect(findings[0]!.check).toBe('permissions');
    });

    it('should report critical when key file has wrong permissions', async () => {
      const { configDir } = await setupTestEnv();
      fs.chmodSync(path.join(configDir, 'key.txt'), 0o644);

      const findings = checkPermissions(configDir);

      const critical = findings.filter((f) => f.severity === 'critical');
      expect(critical.length).toBeGreaterThan(0);
      expect(critical[0]!.message).toContain('644');
    });

    it('should report critical when config dir has wrong permissions', async () => {
      const { configDir } = await setupTestEnv();
      fs.chmodSync(configDir, 0o755);

      const findings = checkPermissions(configDir);

      const critical = findings.filter((f) => f.severity === 'critical');
      expect(critical.length).toBeGreaterThan(0);
      expect(critical[0]!.message).toContain('755');
    });

    it('should report critical when config dir does not exist', () => {
      const nonExistent = path.join(TEST_DIR, 'does-not-exist');
      const findings = checkPermissions(nonExistent);

      const critical = findings.filter((f) => f.severity === 'critical');
      expect(critical.length).toBeGreaterThan(0);
    });
  });

  // ── checkStateFiles() ─────────────────────────────────────────────

  describe('checkStateFiles()', () => {
    it('should report info when all state files are .age', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const { findings, stateFileCount } = checkStateFiles(syncDir);

      expect(stateFileCount).toBe(1);
      const info = findings.filter((f) => f.severity === 'info');
      expect(info.length).toBeGreaterThan(0);
    });

    it('should report critical when plaintext .json state files exist', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      // Write a proper .age file
      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      // Sneak in a plaintext state file
      fs.writeFileSync(
        path.join(syncDir, 'env-vars.json'),
        JSON.stringify({ STRIPE_KEY: 'sk_live_123' }),
      );

      const { findings } = checkStateFiles(syncDir);

      const critical = findings.filter((f) => f.severity === 'critical');
      expect(critical.length).toBeGreaterThan(0);
      expect(critical[0]!.message).toContain('env-vars.json');
    });

    it('should not flag manifest.json as a problem', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const { findings } = checkStateFiles(syncDir);

      const critical = findings.filter((f) => f.severity === 'critical');
      expect(critical).toHaveLength(0);
    });

    it('should warn when sync dir does not exist', () => {
      const { findings, stateFileCount } = checkStateFiles(
        path.join(TEST_DIR, 'nonexistent'),
      );

      expect(stateFileCount).toBe(0);
      const warnings = findings.filter((f) => f.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  // ── checkRemoteTransport() ────────────────────────────────────────

  describe('checkRemoteTransport()', () => {
    it('should report warning when no git repo exists', async () => {
      const { syncDir } = await setupTestEnv();

      const { findings, hasRemote } = checkRemoteTransport(syncDir);

      expect(hasRemote).toBe(false);
      const warnings = findings.filter((f) => f.severity === 'warning');
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  // ── checkRepoSize() ──────────────────────────────────────────────

  describe('checkRepoSize()', () => {
    it('should return size for an existing directory', async () => {
      const { syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const { findings, sizeBytes, sizeHuman } = checkRepoSize(syncDir);

      expect(sizeBytes).toBeGreaterThan(0);
      expect(sizeHuman).toBeTruthy();
      expect(findings[0]!.severity).toBe('info');
    });

    it('should return null for non-existent directory', () => {
      const { sizeBytes, sizeHuman } = checkRepoSize(
        path.join(TEST_DIR, 'nonexistent'),
      );

      expect(sizeBytes).toBeNull();
      expect(sizeHuman).toBeNull();
    });
  });

  // ── formatBytes() ────────────────────────────────────────────────

  describe('formatBytes()', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });
  });

  // ── executeAudit() ───────────────────────────────────────────────

  describe('executeAudit()', () => {
    it('should pass with correct setup', async () => {
      const { publicKey, syncDir } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      const result = executeAudit();

      expect(result.passed).toBe(true);
      expect(result.stateFileCount).toBeGreaterThan(0);
    });

    it('should fail with insecure permissions', async () => {
      const { configDir, syncDir, publicKey } = await setupTestEnv();

      await writeState(
        syncDir,
        { machine: { id: 'test', hostname: 'test' }, projects: [] },
        publicKey,
        'state',
      );

      fs.chmodSync(path.join(configDir, 'key.txt'), 0o644);

      const result = executeAudit();

      expect(result.passed).toBe(false);
      const critical = result.findings.filter(
        (f) => f.severity === 'critical',
      );
      expect(critical.length).toBeGreaterThan(0);
    });
  });
});
