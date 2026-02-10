import { validateRemoteUrl } from '../../src/core/transport.js';

describe('Security: Transport Validation', () => {
  describe('all insecure protocols are rejected', () => {
    const insecureUrls = [
      { url: 'http://github.com/user/repo.git', protocol: 'HTTP' },
      { url: 'http://example.com/repo', protocol: 'HTTP' },
      { url: 'git://github.com/user/repo.git', protocol: 'git://' },
      { url: 'git://example.com/repo', protocol: 'git://' },
      { url: 'ftp://server.com/repo.git', protocol: 'FTP' },
      { url: 'ftp://files.example.com/repos/project', protocol: 'FTP' },
    ];

    for (const { url, protocol } of insecureUrls) {
      it(`should reject ${protocol} URL: ${url}`, () => {
        expect(() => validateRemoteUrl(url)).toThrow();
      });
    }
  });

  describe('all secure protocols are accepted', () => {
    const secureUrls = [
      'git@github.com:user/repo.git',
      'git@gitlab.com:team/project.git',
      'git@bitbucket.org:user/repo.git',
      'git@custom-server.example.com:org/repo.git',
      'https://github.com/user/repo.git',
      'https://gitlab.com/team/project.git',
      'https://bitbucket.org/user/repo.git',
      'ssh://git@github.com/user/repo.git',
      '/local/path/to/repo.git',
      'file:///local/path/to/repo.git',
    ];

    for (const url of secureUrls) {
      it(`should accept secure URL: ${url}`, () => {
        expect(() => validateRemoteUrl(url)).not.toThrow();
      });
    }
  });

  describe('validation cannot be bypassed', () => {
    it('should reject HTTP even with mixed case', () => {
      // URL constructor normalizes protocol to lowercase
      expect(() => validateRemoteUrl('HTTP://github.com/user/repo.git')).toThrow();
    });

    it('should reject null-like values', () => {
      expect(() => validateRemoteUrl(null as unknown as string)).toThrow();
      expect(() => validateRemoteUrl(undefined as unknown as string)).toThrow();
    });

    it('should reject empty and whitespace strings', () => {
      expect(() => validateRemoteUrl('')).toThrow();
      expect(() => validateRemoteUrl('   ')).toThrow();
      expect(() => validateRemoteUrl('\t\n')).toThrow();
    });
  });
});
