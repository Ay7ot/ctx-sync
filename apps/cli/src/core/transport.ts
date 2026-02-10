/**
 * Transport security validation module.
 *
 * Validates Git remote URLs to ensure only secure transport protocols
 * (SSH and HTTPS) are used. Rejects insecure protocols such as HTTP,
 * git://, and ftp:// to prevent data exposure in transit.
 *
 * @module core/transport
 */

/** Allowed transport protocols for Git remotes.
 *  file: is permitted because local-path remotes have no network transit. */
const ALLOWED_PROTOCOLS = ['https:', 'ssh:', 'file:'] as const;

/** SSH remote URL pattern: git@host:user/repo.git */
const SSH_PATTERN = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:.+$/;

/**
 * Validate that a Git remote URL uses a secure transport protocol.
 *
 * Accepts:
 * - SSH URLs: `git@github.com:user/repo.git`
 * - HTTPS URLs: `https://github.com/user/repo.git`
 * - Local paths: `/path/to/repo.git` or `file:///path/to/repo.git`
 *
 * Rejects:
 * - HTTP URLs: `http://...`
 * - Git protocol: `git://...`
 * - FTP protocol: `ftp://...`
 * - Empty or malformed URLs
 *
 * @param url - The Git remote URL to validate.
 * @throws If the URL is empty, malformed, or uses an insecure protocol.
 */
export function validateRemoteUrl(url: string): void {
  if (!url || typeof url !== 'string') {
    throw new Error(
      'Git remote URL is required.\n' +
        'Provide an SSH (git@host:user/repo.git) or HTTPS (https://host/user/repo.git) URL.',
    );
  }

  const trimmed = url.trim();

  if (trimmed.length === 0) {
    throw new Error(
      'Git remote URL is required.\n' +
        'Provide an SSH (git@host:user/repo.git) or HTTPS (https://host/user/repo.git) URL.',
    );
  }

  // Check for SSH-style URLs first (git@host:user/repo.git)
  if (SSH_PATTERN.test(trimmed)) {
    return; // SSH URLs are always secure
  }

  // Allow absolute filesystem paths — no network transit, no security concern
  if (trimmed.startsWith('/')) {
    return;
  }

  // Try to parse as a URL with a protocol
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid Git remote URL: ${trimmed}\n` +
        'Expected SSH (git@host:user/repo.git) or HTTPS (https://host/user/repo.git) URL.',
    );
  }

  // Check for insecure protocols with specific error messages
  if (parsed.protocol === 'http:') {
    throw new Error(
      `Insecure Git remote: ${trimmed}\n` +
        'HTTP transmits data in plaintext. Use HTTPS instead:\n' +
        `  ${trimmed.replace(/^http:/, 'https:')}`,
    );
  }

  if (parsed.protocol === 'git:') {
    throw new Error(
      `Insecure Git remote: ${trimmed}\n` +
        'The git:// protocol transmits data in plaintext. Use SSH or HTTPS instead.',
    );
  }

  if (parsed.protocol === 'ftp:') {
    throw new Error(
      `Insecure Git remote: ${trimmed}\n` +
        'FTP transmits data in plaintext. Use SSH or HTTPS instead.',
    );
  }

  // Check against allowed protocols
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol as (typeof ALLOWED_PROTOCOLS)[number])) {
    throw new Error(
      `Unsupported Git remote protocol: ${parsed.protocol}\n` +
        'Only SSH and HTTPS are supported.',
    );
  }
}
