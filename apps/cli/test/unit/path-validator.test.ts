import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

declare global {
  var TEST_DIR: string;
}

const { validateProjectPath, canonicalize } = await import(
  '../../src/core/path-validator.js'
);

describe('Path Validator Module', () => {
  // Compute at test time (after beforeAll sets CTX_SYNC_HOME)
  function effectiveHome(): string {
    return process.env['CTX_SYNC_HOME'] ?? os.homedir();
  }

  describe('canonicalize()', () => {
    it('should resolve ~ to effective home directory', () => {
      expect(canonicalize('~')).toBe(effectiveHome());
    });

    it('should resolve ~/path to effective home directory path', () => {
      expect(canonicalize('~/projects/my-app')).toBe(
        path.join(effectiveHome(), 'projects', 'my-app'),
      );
    });

    it('should resolve relative paths to absolute', () => {
      const result = canonicalize('projects/my-app');
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should normalise .. segments', () => {
      const result = canonicalize('~/projects/my-app/../other-app');
      expect(result).toBe(path.join(effectiveHome(), 'projects', 'other-app'));
    });

    it('should normalise . segments', () => {
      const result = canonicalize('~/./projects/./my-app');
      expect(result).toBe(path.join(effectiveHome(), 'projects', 'my-app'));
    });

    it('should throw on empty string', () => {
      expect(() => canonicalize('')).toThrow('Path cannot be empty');
    });

    it('should throw on whitespace-only string', () => {
      expect(() => canonicalize('   ')).toThrow('Path cannot be empty');
    });

    it('should trim whitespace', () => {
      const result = canonicalize('  ~/projects/my-app  ');
      expect(result).toBe(path.join(effectiveHome(), 'projects', 'my-app'));
    });
  });

  describe('validateProjectPath()', () => {
    it('should accept valid paths within effective HOME', () => {
      const validPaths = [
        '~/projects/my-app',
        '~/code/api-server',
        `${effectiveHome()}/Documents/work/project`,
      ];

      for (const p of validPaths) {
        expect(() => validateProjectPath(p)).not.toThrow();
      }
    });

    it('should return the canonicalised path', () => {
      const result = validateProjectPath('~/projects/my-app');
      expect(result).toBe(path.join(effectiveHome(), 'projects', 'my-app'));
    });

    it('should reject /etc/passwd', () => {
      expect(() => validateProjectPath('/etc/passwd')).toThrow(
        'Path must be within home directory',
      );
    });

    it('should reject /etc/shadow', () => {
      expect(() => validateProjectPath('/etc/shadow')).toThrow(
        'Path must be within home directory',
      );
    });

    it('should reject /usr/bin/malware', () => {
      expect(() => validateProjectPath('/usr/bin/malware')).toThrow(
        'Path must be within home directory',
      );
    });

    it('should reject absolute path traversal to /etc/passwd', () => {
      expect(() => validateProjectPath('/etc/passwd')).toThrow();
    });

    it('should reject ~/projects/../../../etc/shadow via normalisation', () => {
      expect(() => validateProjectPath('~/projects/../../../etc/shadow')).toThrow();
    });

    it('should reject ~/./projects/../../etc/shadow', () => {
      expect(() => validateProjectPath('~/./projects/../../etc/shadow')).toThrow();
    });

    it('should reject ~/projects/my-app/../../../../tmp/evil', () => {
      expect(() =>
        validateProjectPath('~/projects/my-app/../../../../tmp/evil'),
      ).toThrow();
    });

    it('should reject /var paths', () => {
      expect(() => validateProjectPath('/var/log/syslog')).toThrow();
    });

    it('should reject /bin paths', () => {
      expect(() => validateProjectPath('/bin/sh')).toThrow();
    });

    it('should reject /sbin paths', () => {
      expect(() => validateProjectPath('/sbin/init')).toThrow();
    });

    it('should reject /root paths', () => {
      expect(() => validateProjectPath('/root/.ssh')).toThrow();
    });

    it('should reject paths outside HOME entirely (e.g. /tmp)', () => {
      expect(() => validateProjectPath('/tmp/some-dir')).toThrow();
    });

    it('should accept the home directory itself', () => {
      expect(() => validateProjectPath('~')).not.toThrow();
    });
  });

  describe('symlink validation', () => {
    let testDir: string;

    beforeEach(() => {
      testDir = path.join(effectiveHome(), 'symlink-test-' + Date.now());
      fs.mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should reject symlinks pointing outside HOME', () => {
      const symlinkPath = path.join(testDir, 'evil-link');
      try {
        fs.symlinkSync('/etc', symlinkPath);
      } catch {
        // Skip if symlink creation fails (permissions)
        return;
      }

      // The symlink target is /etc which is blocked
      expect(() => validateProjectPath(symlinkPath)).toThrow();
    });

    it('should accept symlinks within HOME pointing to valid locations', () => {
      const realDir = path.join(effectiveHome(), '.ctx-sync-test-real-' + Date.now());
      const linkDir = path.join(effectiveHome(), '.ctx-sync-test-link-' + Date.now());

      try {
        fs.mkdirSync(realDir, { recursive: true });
        fs.symlinkSync(realDir, linkDir);

        expect(() => validateProjectPath(linkDir)).not.toThrow();
      } finally {
        try { fs.unlinkSync(linkDir); } catch { /* noop */ }
        try { fs.rmdirSync(realDir); } catch { /* noop */ }
      }
    });
  });
});
