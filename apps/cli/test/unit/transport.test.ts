import { validateRemoteUrl } from '../../src/core/transport.js';

describe('Transport Security Validation', () => {
  describe('validateRemoteUrl() — accepted protocols', () => {
    it('should accept SSH URLs (git@host:user/repo.git)', () => {
      expect(() => validateRemoteUrl('git@github.com:user/repo.git')).not.toThrow();
    });

    it('should accept SSH URLs with custom ports (ssh://)', () => {
      expect(() =>
        validateRemoteUrl('ssh://git@github.com:22/user/repo.git'),
      ).not.toThrow();
    });

    it('should accept SSH URLs with subdomains', () => {
      expect(() =>
        validateRemoteUrl('git@gitlab.company.com:team/project.git'),
      ).not.toThrow();
    });

    it('should accept SSH URLs with hyphens in hostname', () => {
      expect(() =>
        validateRemoteUrl('git@my-server.example.com:user/repo.git'),
      ).not.toThrow();
    });

    it('should accept HTTPS URLs', () => {
      expect(() =>
        validateRemoteUrl('https://github.com/user/repo.git'),
      ).not.toThrow();
    });

    it('should accept HTTPS URLs without .git suffix', () => {
      expect(() =>
        validateRemoteUrl('https://github.com/user/repo'),
      ).not.toThrow();
    });

    it('should accept HTTPS URLs with authentication token', () => {
      expect(() =>
        validateRemoteUrl('https://oauth2:token@github.com/user/repo.git'),
      ).not.toThrow();
    });

    it('should accept absolute filesystem paths (no network transit)', () => {
      expect(() => validateRemoteUrl('/path/to/repo.git')).not.toThrow();
    });

    it('should accept file:// URLs (no network transit)', () => {
      expect(() => validateRemoteUrl('file:///path/to/repo.git')).not.toThrow();
    });
  });

  describe('validateRemoteUrl() — rejected protocols', () => {
    it('should reject HTTP URLs with "Insecure Git remote" error', () => {
      expect(() =>
        validateRemoteUrl('http://github.com/user/repo.git'),
      ).toThrow('Insecure Git remote');
    });

    it('should reject HTTP URLs and suggest HTTPS alternative', () => {
      expect(() =>
        validateRemoteUrl('http://github.com/user/repo.git'),
      ).toThrow('https:');
    });

    it('should reject git:// URLs with "Insecure Git remote" error', () => {
      expect(() =>
        validateRemoteUrl('git://github.com/user/repo.git'),
      ).toThrow('Insecure Git remote');
    });

    it('should reject ftp:// URLs with "Insecure Git remote" error', () => {
      expect(() =>
        validateRemoteUrl('ftp://server.com/repo.git'),
      ).toThrow('Insecure Git remote');
    });

    it('should reject other insecure protocols', () => {
      expect(() =>
        validateRemoteUrl('telnet://server.com/repo'),
      ).toThrow('Unsupported Git remote protocol');
    });
  });

  describe('validateRemoteUrl() — edge cases', () => {
    it('should throw on empty string', () => {
      expect(() => validateRemoteUrl('')).toThrow('Git remote URL is required');
    });

    it('should throw on whitespace-only string', () => {
      expect(() => validateRemoteUrl('   ')).toThrow('Git remote URL is required');
    });

    it('should throw on malformed URLs', () => {
      expect(() => validateRemoteUrl('not-a-url')).toThrow('Invalid Git remote URL');
    });

    it('should accept URLs with leading/trailing whitespace (trimmed)', () => {
      expect(() =>
        validateRemoteUrl('  https://github.com/user/repo.git  '),
      ).not.toThrow();
    });

    it('should accept URLs with leading/trailing whitespace for SSH', () => {
      expect(() =>
        validateRemoteUrl('  git@github.com:user/repo.git  '),
      ).not.toThrow();
    });
  });
});
