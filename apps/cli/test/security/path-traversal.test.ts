import * as os from 'node:os';

declare global {
  var TEST_DIR: string;
}

const { validateProjectPath } = await import('../../src/core/path-validator.js');

describe('Security: Path Traversal Prevention', () => {
  // Compute at test time (after beforeAll sets CTX_SYNC_HOME)
  function homeDir(): string {
    return process.env['CTX_SYNC_HOME'] ?? os.homedir();
  }

  it('should reject all paths outside HOME directory', () => {
    // Build a relative traversal that actually escapes HOME from the CWD
    const cwdDepth = process.cwd().split('/').filter(Boolean).length;
    const escapingRelative = '../'.repeat(cwdDepth) + 'etc/shadow';

    const maliciousPaths = [
      '/etc/passwd',
      '/etc/shadow',
      '/usr/bin/malware',
      '/tmp/../../etc/passwd',
      escapingRelative,
      '/var/log/auth.log',
      '/proc/self/environ',
      '/dev/null',
      '/sys/kernel',
      '/boot/vmlinuz',
    ];

    for (const p of maliciousPaths) {
      expect(() => validateProjectPath(p)).toThrow();
    }
  });

  it('should reject path traversal attempts that escape HOME', () => {
    const traversalPaths = [
      '~/projects/../../../etc/passwd',
      '~/./projects/../../etc/shadow',
      '~/projects/my-app/../../../../tmp/evil',
      '~/../etc/passwd',
      '~/../../../var/log',
    ];

    for (const p of traversalPaths) {
      expect(() => validateProjectPath(p)).toThrow();
    }
  });

  it('should accept valid project paths within HOME', () => {
    const home = homeDir();
    const validPaths = [
      '~/projects/my-app',
      '~/code/api-server',
      `${home}/Documents/work/project`,
      `${home}/.config/some-tool`,
    ];

    for (const p of validPaths) {
      expect(() => validateProjectPath(p)).not.toThrow();
    }
  });

  it('should not be fooled by double-dot sequences within HOME', () => {
    // These resolve within HOME and are fine
    const result = validateProjectPath('~/projects/my-app/../other-app');
    expect(result).toContain(homeDir());

    // These escape HOME and must be rejected
    expect(() => validateProjectPath('~/../../../etc/passwd')).toThrow();
  });

  it('should block all known system directory prefixes', () => {
    const systemDirs = [
      '/etc', '/usr', '/bin', '/sbin', '/var',
      '/sys', '/proc', '/dev', '/boot', '/lib',
      '/lib64', '/root',
    ];

    for (const dir of systemDirs) {
      expect(() => validateProjectPath(dir)).toThrow();
      expect(() => validateProjectPath(`${dir}/something`)).toThrow();
    }
  });

  it('should handle empty and invalid inputs gracefully', () => {
    expect(() => validateProjectPath('')).toThrow();
    expect(() => validateProjectPath('   ')).toThrow();
  });
});
