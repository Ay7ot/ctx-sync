import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/** Global test directory — unique per test run */
const TEST_DIR = path.join(os.tmpdir(), 'ctx-sync-test', Date.now().toString());

// Make TEST_DIR available globally
declare global {
  var TEST_DIR: string;
}

globalThis.TEST_DIR = TEST_DIR;

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

// Cleanup after all tests
afterAll(() => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    /* Already deleted by another file in this worker — ignore */
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
