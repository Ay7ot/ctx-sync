/**
 * Unit tests for the custom error classes and error handling utilities.
 *
 * Verifies:
 *   - Each error class produces correct message format and code.
 *   - classifyError maps raw errors to the right subclass.
 *   - formatError hides stack traces without --verbose.
 *   - formatError shows stack traces with --verbose or DEBUG.
 *   - withErrorHandler catches errors and sets process.exitCode.
 *   - toFriendlyString includes message and suggestion.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const {
  CtxSyncError,
  EncryptionError,
  SyncError,
  ConfigError,
  SecurityError,
  ProjectError,
  EdgeCaseError,
  classifyError,
  formatError,
  isVerbose,
  withErrorHandler,
} = await import('../../src/utils/errors.js');

describe('Custom Error Classes', () => {
  describe('CtxSyncError', () => {
    it('should create error with message, code, and suggestion', () => {
      const err = new CtxSyncError('Something went wrong', 'TEST_CODE', 'Try again');
      expect(err.message).toBe('Something went wrong');
      expect(err.code).toBe('TEST_CODE');
      expect(err.suggestion).toBe('Try again');
      expect(err.name).toBe('CtxSyncError');
      expect(err).toBeInstanceOf(Error);
    });

    it('should produce a friendly string with suggestion', () => {
      const err = new CtxSyncError('Bad thing happened', 'BAD', 'Fix it');
      const friendly = err.toFriendlyString();
      expect(friendly).toContain('Error: Bad thing happened');
      expect(friendly).toContain('Suggested fix: Fix it');
    });

    it('should have a stack trace', () => {
      const err = new CtxSyncError('test', 'TEST', 'fix');
      expect(err.stack).toBeDefined();
    });
  });

  describe('EncryptionError', () => {
    it('should set correct code and default suggestion', () => {
      const err = new EncryptionError('Decryption failed');
      expect(err.code).toBe('ENCRYPTION_FAILED');
      expect(err.name).toBe('EncryptionError');
      expect(err.suggestion).toContain('ctx-sync key verify');
    });

    it('should accept custom suggestion', () => {
      const err = new EncryptionError('Bad key', 'Use a different key');
      expect(err.suggestion).toBe('Use a different key');
    });
  });

  describe('SyncError', () => {
    it('should set correct code and default suggestion', () => {
      const err = new SyncError('Push failed');
      expect(err.code).toBe('SYNC_FAILED');
      expect(err.name).toBe('SyncError');
      expect(err.suggestion).toContain('ctx-sync init');
    });
  });

  describe('ConfigError', () => {
    it('should set correct code and default suggestion', () => {
      const err = new ConfigError('Config missing');
      expect(err.code).toBe('CONFIG_ERROR');
      expect(err.name).toBe('ConfigError');
      expect(err.suggestion).toContain('ctx-sync init');
    });
  });

  describe('SecurityError', () => {
    it('should set correct code and default suggestion', () => {
      const err = new SecurityError('Insecure transport');
      expect(err.code).toBe('SECURITY_ERROR');
      expect(err.name).toBe('SecurityError');
      expect(err.suggestion).toContain('ctx-sync audit');
    });
  });

  describe('ProjectError', () => {
    it('should set correct code and default suggestion', () => {
      const err = new ProjectError('Project not found');
      expect(err.code).toBe('PROJECT_ERROR');
      expect(err.name).toBe('ProjectError');
      expect(err.suggestion).toContain('ctx-sync list');
    });
  });

  describe('EdgeCaseError', () => {
    it('should set correct code and default suggestion', () => {
      const err = new EdgeCaseError('Disk full');
      expect(err.code).toBe('EDGE_CASE_ERROR');
      expect(err.name).toBe('EdgeCaseError');
      expect(err.suggestion).toContain('permissions');
    });
  });
});

describe('classifyError', () => {
  it('should return CtxSyncError as-is', () => {
    const original = new EncryptionError('already classified');
    const result = classifyError(original);
    expect(result).toBe(original);
  });

  it('should classify decryption errors as EncryptionError', () => {
    const err = new Error('Failed to decrypt data');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(EncryptionError);
  });

  it('should classify age-related errors as EncryptionError', () => {
    const err = new Error('age: invalid ciphertext');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(EncryptionError);
  });

  it('should classify missing key errors as ConfigError', () => {
    const err = new Error('ENOENT: no such file or directory, key.txt');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(ConfigError);
  });

  it('should classify permission errors as SecurityError', () => {
    const err = new Error('EACCES: permission denied');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(SecurityError);
  });

  it('should classify disk full errors as EdgeCaseError', () => {
    const err = new Error('ENOSPC: no space left on device');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(EdgeCaseError);
  });

  it('should classify git errors as SyncError', () => {
    const err = new Error('fatal: not a git repository');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(SyncError);
  });

  it('should classify insecure transport errors as SecurityError', () => {
    const err = new Error('Insecure Git remote: http://example.com');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(SecurityError);
  });

  it('should classify path traversal errors as SecurityError', () => {
    const err = new Error('Path outside home directory: path traversal detected');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(SecurityError);
  });

  it('should wrap unknown errors as CtxSyncError', () => {
    const err = new Error('Something totally unexpected');
    const result = classifyError(err);
    expect(result).toBeInstanceOf(CtxSyncError);
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('should handle string errors', () => {
    const result = classifyError('just a string');
    expect(result).toBeInstanceOf(CtxSyncError);
    expect(result.message).toBe('just a string');
  });

  it('should handle non-Error objects', () => {
    const result = classifyError({ code: 'ENOENT' });
    expect(result).toBeInstanceOf(CtxSyncError);
  });
});

describe('isVerbose', () => {
  const originalArgv = process.argv;
  const originalDebug = process.env['DEBUG'];

  afterEach(() => {
    process.argv = originalArgv;
    if (originalDebug === undefined) {
      delete process.env['DEBUG'];
    } else {
      process.env['DEBUG'] = originalDebug;
    }
  });

  it('should return false by default', () => {
    process.argv = ['node', 'script.js'];
    delete process.env['DEBUG'];
    expect(isVerbose()).toBe(false);
  });

  it('should return true with --verbose flag', () => {
    process.argv = ['node', 'script.js', '--verbose'];
    delete process.env['DEBUG'];
    expect(isVerbose()).toBe(true);
  });

  it('should return true with -v flag', () => {
    process.argv = ['node', 'script.js', '-v'];
    delete process.env['DEBUG'];
    expect(isVerbose()).toBe(true);
  });

  it('should return true with DEBUG env var set', () => {
    process.argv = ['node', 'script.js'];
    process.env['DEBUG'] = '*';
    expect(isVerbose()).toBe(true);
  });
});

describe('formatError', () => {
  const originalArgv = process.argv;
  const originalDebug = process.env['DEBUG'];

  afterEach(() => {
    process.argv = originalArgv;
    if (originalDebug === undefined) {
      delete process.env['DEBUG'];
    } else {
      process.env['DEBUG'] = originalDebug;
    }
  });

  it('should include message and suggestion without verbose', () => {
    process.argv = ['node', 'script.js'];
    delete process.env['DEBUG'];

    const err = new EncryptionError('Decryption failed');
    const formatted = formatError(err);

    expect(formatted).toContain('Error: Decryption failed');
    expect(formatted).toContain('Suggested fix:');
    expect(formatted).not.toContain('Stack trace:');
  });

  it('should include stack trace with --verbose', () => {
    process.argv = ['node', 'script.js', '--verbose'];
    delete process.env['DEBUG'];

    const err = new EncryptionError('Decryption failed');
    const formatted = formatError(err);

    expect(formatted).toContain('Error: Decryption failed');
    expect(formatted).toContain('Stack trace:');
  });

  it('should include stack trace with DEBUG env', () => {
    process.argv = ['node', 'script.js'];
    process.env['DEBUG'] = '*';

    const err = new EncryptionError('Decryption failed');
    const formatted = formatError(err);

    expect(formatted).toContain('Stack trace:');
  });

  it('should handle raw Error objects', () => {
    process.argv = ['node', 'script.js'];
    delete process.env['DEBUG'];

    const err = new Error('Something broke');
    const formatted = formatError(err);

    expect(formatted).toContain('Error:');
    expect(formatted).toContain('Suggested fix:');
  });

  it('should handle string errors', () => {
    const formatted = formatError('string error');
    expect(formatted).toContain('Error: string error');
  });
});

describe('withErrorHandler', () => {
  let errorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
    process.argv = ['node', 'script.js'];
    delete process.env['DEBUG'];
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('should execute the handler normally on success', async () => {
    const fn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(fn).toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('should catch errors and set process.exitCode', async () => {
    const fn = jest.fn<() => Promise<void>>().mockRejectedValue(
      new Error('test failure'),
    );
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(process.exitCode).toBe(1);
  });

  it('should print friendly error message on failure', async () => {
    const fn = jest.fn<() => Promise<void>>().mockRejectedValue(
      new EncryptionError('Key mismatch'),
    );
    const wrapped = withErrorHandler(fn);
    await wrapped();
    expect(errorSpy).toHaveBeenCalled();
    const output = (errorSpy.mock.calls[0] as string[])[0] as string;
    expect(output).toContain('Error: Key mismatch');
    expect(output).toContain('Suggested fix:');
  });

  it('should not show stack trace without verbose', async () => {
    process.argv = ['node', 'script.js'];
    const fn = jest.fn<() => Promise<void>>().mockRejectedValue(
      new Error('test error'),
    );
    const wrapped = withErrorHandler(fn);
    await wrapped();
    const output = (errorSpy.mock.calls[0] as string[])[0] as string;
    expect(output).not.toContain('Stack trace:');
  });

  it('should pass arguments through to the handler', async () => {
    const fn = jest.fn<(a: string, b: number) => Promise<void>>().mockResolvedValue(undefined);
    const wrapped = withErrorHandler(fn);
    await wrapped('hello', 42);
    expect(fn).toHaveBeenCalledWith('hello', 42);
  });
});
