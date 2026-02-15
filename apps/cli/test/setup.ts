import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Global test directory — unique per worker (pid + timestamp + random) */
const TEST_DIR = path.join(
  os.tmpdir(),
  'ctx-sync-test',
  `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

// Make TEST_DIR available globally
declare global {
  var TEST_DIR: string;
}

globalThis.TEST_DIR = TEST_DIR;

// Ensure Git commits in tests never depend on runner-level git config.
// Some tests create commits via simple-git and can fail in CI when user.name/user.email
// are not configured globally. Use ||= (not ??=) because CI runners may set these to
// empty strings, which are falsy but not nullish.
process.env['GIT_AUTHOR_NAME'] ||= 'ctx-sync test';
process.env['GIT_AUTHOR_EMAIL'] ||= 'test@ctx-sync.local';
process.env['GIT_COMMITTER_NAME'] ||= process.env['GIT_AUTHOR_NAME']!;
process.env['GIT_COMMITTER_EMAIL'] ||= process.env['GIT_AUTHOR_EMAIL']!;

// Setup before all tests
beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  process.env['CTX_SYNC_HOME'] = TEST_DIR;
  process.env['CTX_SYNC_TEST_MODE'] = 'true';
});

// With ESM (extensionsToTreatAsEsm), Jest caches this module per-worker
// rather than re-evaluating it per test file. This means afterAll from the
// first test file deletes TEST_DIR, and the second file in the same worker
// finds it missing. Guard against this by ensuring TEST_DIR exists before
// every test.
beforeEach(() => {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
});

// Cleanup after all tests — only remove CONTENTS, not the directory itself.
// With ESM module caching, afterAll fires when the first test file in a worker
// completes, but beforeEach guards are not re-registered for subsequent files.
// Keeping TEST_DIR itself alive prevents ENOENT errors in later files.
afterAll(() => {
  try {
    if (fs.existsSync(TEST_DIR)) {
      const entries = fs.readdirSync(TEST_DIR);
      for (const entry of entries) {
        fs.rmSync(path.join(TEST_DIR, entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* Already cleaned by another file in this worker — ignore */
  }
});

// Clean between tests (preserve .git)
afterEach(() => {
  if (!fs.existsSync(TEST_DIR)) return;
  try {
    const entries = fs.readdirSync(TEST_DIR);
    for (const entry of entries) {
      if (entry !== '.git') {
        fs.rmSync(path.join(TEST_DIR, entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* TEST_DIR may have been removed concurrently — ignore */
  }
});
