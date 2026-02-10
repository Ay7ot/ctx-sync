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

// Cleanup after all tests
afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// Clean between tests (preserve .git)
afterEach(() => {
  const entries = fs.readdirSync(TEST_DIR);
  for (const entry of entries) {
    if (entry !== '.git') {
      fs.rmSync(path.join(TEST_DIR, entry), { recursive: true, force: true });
    }
  }
});
