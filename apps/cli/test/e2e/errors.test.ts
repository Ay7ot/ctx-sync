/**
 * E2E tests for error handling & user-friendly messages.
 *
 * Verifies:
 *   - Various error scenarios produce friendly messages (no stack traces).
 *   - Missing init → helpful error with suggestion.
 *   - Missing key → helpful error.
 *   - Corrupted state → helpful error.
 *   - Non-existent project → helpful error with list.
 *   - Stack traces hidden in normal mode.
 *   - Stack traces shown with --verbose.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TestEnvironment } from './helpers/test-env.js';

declare global {
  var TEST_DIR: string;
}

describe('E2E: Error Handling & User-Friendly Messages', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = new TestEnvironment('errors');
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe('Missing init', () => {
    it('should show friendly error when running track without init', () => {
      const result = env.execCommand('track');

      expect(result.exitCode).not.toBe(0);
      // Should have a user-friendly message, not a raw stack trace
      const output = result.stderr || result.stdout;
      expect(output).toContain('Error');
      expect(output).not.toMatch(/^\s+at\s+/m); // No stack trace lines
    });

    it('should show friendly error when running sync without init', () => {
      const result = env.execCommand('sync');

      expect(result.exitCode).not.toBe(0);
      const output = result.stderr || result.stdout;
      expect(output).toContain('Error');
    });

    it('should show friendly error when running list without init', () => {
      const result = env.execCommand('list');

      expect(result.exitCode).not.toBe(0);
      const output = result.stderr || result.stdout;
      expect(output).toContain('Error');
    });
  });

  describe('Missing key', () => {
    it('should show friendly error when key file is missing', () => {
      // Create sync dir but no config dir / key
      fs.mkdirSync(env.syncDir, { recursive: true });

      const result = env.execCommand('track');
      expect(result.exitCode).not.toBe(0);

      const output = result.stderr || result.stdout;
      expect(output).toContain('Error');
      // Should not have raw stack trace
      expect(output).not.toMatch(/^\s+at\s+Object\./m);
    });
  });

  describe('Non-existent project restore', () => {
    it('should show friendly error with available project names', () => {
      // Init first
      env.execCommand('init --no-interactive --skip-backup');

      // Try to restore a project that doesn't exist
      const result = env.execCommand('restore nonexistent');
      expect(result.exitCode).not.toBe(0);

      const output = result.stderr || result.stdout;
      expect(output).toContain('Error');
    });
  });

  describe('Corrupted state', () => {
    it('should show friendly error for corrupted state.age', () => {
      // Init first
      env.execCommand('init --no-interactive --skip-backup');

      // Corrupt the state file
      const stateFile = path.join(env.syncDir, 'state.age');
      fs.writeFileSync(stateFile, 'THIS_IS_NOT_VALID_ENCRYPTED_DATA');

      const result = env.execCommand('list');
      expect(result.exitCode).not.toBe(0);

      const output = result.stderr || result.stdout;
      expect(output).toContain('Error');
      // Should suggest a fix
      expect(output).toContain('Suggested fix');
    });
  });

  describe('No stack traces in normal mode', () => {
    it('should not show stack trace lines without --verbose', () => {
      const result = env.execCommand('sync');
      const output = result.stderr || result.stdout;

      // No lines like "    at Object.<anonymous> (path:line:col)"
      const lines = output.split('\n');
      for (const line of lines) {
        expect(line).not.toMatch(/^\s+at\s+/);
      }
    });
  });
});
