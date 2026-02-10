# Context Sync - Complete Product Specification

## Executive Summary

**Context Sync** is a CLI tool that syncs your complete development context across multiple machines using Git as the backend. It solves the "23-minute context switch" problem by preserving and restoring your entire development state.

### Key Innovation
- **No backend required** - Uses Git for syncing
- **Everything encrypted** - Full state encryption with Age (not just secrets)
- **Encrypt-by-default** - All env vars encrypted, eliminating false negatives
- **Zero manual entry** - Import from .env files
- **Zero side-channel leaks** - No secrets in CLI args, shell history, or logs
- **Mental state preserved** - Track tasks, blockers, breadcrumbs

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Market Analysis](#market-analysis)
3. [Complete Feature Set](#complete-feature-set)
4. [Technical Architecture](#technical-architecture)
5. [Security Strategy](#security-strategy)
6. [Implementation Plan](#implementation-plan)
7. [User Experience](#user-experience)

---

## Problem Statement

### The Context Switching Tax

Research shows developers lose **23 minutes** regaining flow state after interruptions. When switching between machines, they face:

- ❌ Lost project state (which repos, branches)
- ❌ Missing environment variables
- ❌ Forgotten running services
- ❌ Lost mental context (what was I working on?)
- ❌ Manual reconfiguration of terminal sessions
- ❌ Docker containers not running

### Current Solutions (Incomplete)

| Tool | What it syncs | What it DOESN'T sync |
|------|--------------|---------------------|
| **Atuin** | Shell history | Active projects, git state |
| **Fig/dotsync** | Config files | Project context, recent work |
| **tmuxinator** | Session templates | Can't follow you to another machine |
| **context-sync (AI)** | AI memory | General dev workflow |

**Gap in Market:** No tool syncs complete development context across machines.

---

## Market Analysis

### Validation

- **Atuin**: 37k+ GitHub stars (just shell history!)
- **Problem**: Active GitHub issues requesting this functionality
- **Research**: Remote work makes multi-machine development common
- **Evidence**: tmux session managers show demand for state restoration

### Target Users

1. **Solo Developers** - Work laptop + home desktop
2. **Remote Workers** - Multiple workstations + cloud instances
3. **Consultants** - Client machines + personal machines
4. **Teams** - Shared development environments

### Why This Hasn't Been Built

1. Most tools focus on dotfiles (config) not context (state)
2. Security concerns with syncing secrets
3. Perceived need for backend infrastructure
4. Complexity of tracking diverse state

**Our Solution:** Git + full Age encryption = No backend needed + Everything encrypted by default

---

## Complete Feature Set

### 🎯 P0 - MVP Features (Must Have)

#### 1. Project State Tracking
```json
{
  "activeProjects": [
    {
      "name": "my-app",
      "path": "~/projects/my-app",
      "gitBranch": "feature/payments",
      "gitRemote": "origin",
      "lastAccessed": "2025-02-10T14:30:00Z",
      "stashCount": 2,
      "uncommittedChanges": true
    }
  ]
}
```

**What it does:**
- Auto-detects active Git repositories
- Tracks current branch per project
- Syncs across machines
- Restores git state on new machine

#### 2. Environment Variables (Encrypted by Default)
```json
{
  "envVars": {
    "my-app": {
      "NODE_ENV": { "value": "development" },
      "PORT": { "value": "3000" },
      "STRIPE_KEY": { "value": "sk_live_abc123" },
      "DATABASE_URL": { "value": "postgres://user:pass@localhost/db" }
    }
  }
}
```

> **Note:** The entire `env-vars.age` file is encrypted as one Age blob. There is no per-value encryption distinction -- everything is encrypted together.

**Features:**
- Import from .env files (batch)
- **Encrypt-by-default** for all values (no false negatives)
- Age encryption for the entire env vars file
- Zero manual entry on new machines
- Secrets never accepted as CLI arguments (hidden prompt / stdin only)

#### 3. Docker/Container State
```json
{
  "dockerCompose": {
    "my-app": {
      "composeFile": "~/projects/my-app/docker-compose.yml",
      "runningServices": [
        {
          "name": "postgres",
          "container": "my-app-db",
          "port": 5432,
          "autoStart": true
        }
      ]
    }
  }
}
```

**Impact:** Saves 10+ minutes/day per developer

#### 4. Mental Context (Critical!)
```json
{
  "mentalContext": {
    "my-app": {
      "currentTask": "Implementing Stripe webhook handlers",
      "lastWorkingOn": {
        "file": "src/webhooks/stripe.ts",
        "line": 45,
        "description": "Adding signature verification"
      },
      "blockers": [
        "Waiting for staging API keys from ops"
      ],
      "nextSteps": [
        "Test webhook with Stripe CLI",
        "Add error handling"
      ],
      "relatedLinks": [
        "https://stripe.com/docs/webhooks",
        "PR: https://github.com/company/repo/pull/789"
      ],
      "breadcrumbs": [
        "Started at line 23 - added webhook route",
        "TODO: Handle edge case for duplicate events"
      ]
    }
  }
}
```

**Solves:** The 23-minute flow state recovery problem

#### 5. Working Directories
```json
{
  "recentDirs": [
    { 
      "path": "~/projects/my-app/src", 
      "frequency": 45, 
      "lastVisit": "2025-02-10T14:00:00Z" 
    }
  ],
  "pinnedDirs": ["~/projects/my-app", "~/dotfiles"]
}
```

#### 6. Running Services
```json
{
  "services": [
    {
      "project": "my-app",
      "name": "dev-server",
      "port": 3000,
      "command": "npm run dev",
      "autoStart": true
    }
  ]
}
```

---

### 📦 V2 Features (Post-MVP)

#### 7. Terminal Sessions (Tmux/Terminal)
```json
{
  "tmuxSessions": {
    "my-app": {
      "windows": [
        { 
          "name": "editor", 
          "panes": [
            { "command": "nvim .", "cwd": "~/projects/my-app" }
          ]
        }
      ]
    }
  }
}
```

#### 8. Git Worktrees
```json
{
  "gitWorktrees": {
    "my-app": {
      "main": "~/projects/my-app-main",
      "feature-auth": "~/projects/my-app-auth"
    }
  }
}
```

#### 9. Tool Versions
```json
{
  "toolVersions": {
    "my-app": {
      "node": "20.11.0",
      "npm": "10.2.4",
      "python": "3.11.5"
    }
  }
}
```

#### 10. IDE State
```json
{
  "ideState": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "github.copilot"
      ],
      "settings": {
        "editor.formatOnSave": true
      }
    }
  }
}
```

---

### 🎁 V3 Features (Nice to Have)

11. Browser tabs/context
12. Test state & coverage
13. Time tracking & analytics
14. Custom scripts & aliases
15. Database seed data
16. API endpoints & mock servers
17. Notification/DND settings

---

## Technical Architecture

### Core Philosophy
**Use Git as the Database**

- ✅ No backend infrastructure
- ✅ Users control their data
- ✅ Version history built-in
- ✅ Works with GitHub/GitLab/private repos
- ✅ Scales infinitely

### File Structure

All state files are encrypted with Age. Only `manifest.json` (version + timestamps) is plaintext.

```
~/.context-sync/
├── .git/                    # Git repo (syncs to remote)
├── manifest.json           # Version, timestamps (no sensitive data)
├── state.age               # Encrypted: projects & branches
├── env-vars.age            # Encrypted: all environment variables
├── docker-state.age        # Encrypted: container configurations
├── mental-context.age      # Encrypted: tasks, blockers, breadcrumbs
├── services.age            # Encrypted: running services & commands
├── directories.age         # Encrypted: recent & pinned directories
└── sessions/
    ├── my-app.age          # Encrypted: project-specific session
    └── api-server.age

~/.config/ctx-sync/          # Local config (NEVER synced to Git)
├── key.txt                 # Private key (permissions: 600)
├── config.json             # Local preferences, safe-list
└── approved-commands.json  # Per-machine approved command cache
```

> **Security:** The `~/.config/ctx-sync/` directory is **never** committed to Git. It holds only local configuration and the private key. Directory permissions are set to `700`.

### NPM Dependencies (Minimal)
```json
{
  "name": "ctx-sync",
  "version": "1.0.0",
  "dependencies": {
    "simple-git": "^3.22.0",        // Git operations
    "age-encryption": "^0.1.3",      // Secret encryption
    "conf": "^12.0.0",               // Config storage
    "commander": "^11.1.0",          // CLI framework
    "chalk": "^5.3.0",               // Terminal colors
    "ora": "^8.0.1",                 // Spinners
    "enquirer": "^2.4.1",            // Interactive prompts
    "execa": "^8.0.1",               // Shell commands
    "chokidar": "^3.5.3"             // File watching
  }
}
```

### Data Flow

```
┌─────────────────┐
│   Machine A     │
│  (Work Laptop)  │
└────────┬────────┘
         │
         │ ctx-sync track
         │ (auto-saves state to JSON)
         │
         ▼
┌─────────────────┐
│  ~/.ctx-sync/   │
│  (Git Repo)     │
└────────┬────────┘
         │
         │ git push
         │
         ▼
┌─────────────────┐
│  GitHub/GitLab  │
│  (Private Repo) │
└────────┬────────┘
         │
         │ git pull
         │
         ▼
┌─────────────────┐
│  ~/.ctx-sync/   │
│  (Machine B)    │
└────────┬────────┘
         │
         │ ctx-sync restore
         │
         ▼
┌─────────────────┐
│   Machine B     │
│  (Home Desktop) │
└─────────────────┘
```

---

## Security Strategy

### Threat Model

Before describing mitigations, we define what we defend against:

| Threat | Description | Severity |
|--------|-------------|----------|
| **Git remote compromise** | Attacker gains read/write to the sync repo | Critical |
| **Private key compromise** | Attacker obtains the Age private key | Critical |
| **Local machine compromise** | Malware or unauthorized user on a synced machine | High |
| **Man-in-the-Middle** | Attacker intercepts Git transport | High |
| **Shoulder surfing** | Visual exposure of secrets during setup | Medium |
| **Side-channel leakage** | Secrets in shell history, process lists, temp files | Medium |
| **Insider threat (teams)** | Malicious or departed team member | Medium |

### Core Principle: Encrypt Everything by Default

**Problem:** Heuristic secret detection has dangerous false negatives. A single miss means a plaintext secret committed to Git forever.

**Solution:** Encrypt **all** environment variables and **all** state files by default. Only values on an explicit safe-list are stored in plaintext.

### The Age Encryption Approach

**Why Age?**
- Modern, simple, audited cryptography
- Better than GPG (no configuration complexity)
- Multi-recipient support for teams
- Post-quantum algorithm support
- NPM package available (`age-encryption`)

### How It Works

1. **First Time Setup (Machine A):**
```bash
$ ctx-sync init

🔐 Generating encryption key...
✅ Public key:  age1abc123...
✅ Private key saved to: ~/.config/ctx-sync/key.txt
   Permissions set to 600 (owner read/write only)

⚠️  IMPORTANT: Back up your private key!

💾 Backup method:
❯ Save to 1Password/Bitwarden
  Copy to clipboard (clears after 30s)
  Skip (not recommended)

# User saves to 1Password
```

> **Note:** QR code display was removed as a backup option due to screen-capture risk (cameras, screen recording, shoulder surfing).

2. **Adding Secrets:**
```bash
$ ctx-sync env import .env

🔍 Found 12 env vars
  🔐 All 12 will be encrypted (encrypt-by-default)
  💡 3 could be stored as plain (NODE_ENV, PORT, DEBUG)
     Use --plain-list to customize safe values

Encrypting with age... ✅
Syncing to Git... ✅
```

3. **New Machine (Machine B) - ONE TIME:**
```bash
$ ctx-sync init --restore

🔑 Restore encryption key:
[Paste from 1Password]

✅ Key restored (permissions set to 600)
📥 Syncing from Git...
✅ Decrypted 47 env vars

⚠️  Validating Git remote security...
✅ Remote uses SSH transport (secure)

Ready to work! 🎉
```

4. **From Then On - AUTOMATIC:**
```bash
$ ctx-sync sync
✅ 3 new encrypted env vars synced
✅ Auto-decrypted locally
```

### What Gets Synced to Git

**ALL state files are encrypted.** The only plaintext in Git is structural metadata:

```json
{
  "version": "1.0.0",
  "lastSync": "2025-02-10T14:30:00Z",
  "encrypted": true,
  "state": "-----BEGIN AGE ENCRYPTED FILE-----\nYWdlLWVu..."
}
```

Even project names, paths, Docker config, and mental context are encrypted. An attacker with read access to the Git repo sees only ciphertext.

### Full State Encryption Architecture

```
Before encryption (in memory only, NEVER written to disk):
┌──────────────────────────────────────┐
│  state.json (projects, branches)     │
│  env-vars.json (all values)          │
│  docker-state.json (services)        │
│  mental-context.json (tasks)         │
│  services.json (commands, ports)     │
│  directories.json (paths)            │
└──────────────────────────────────────┘

After encryption (what exists on disk / in Git):
┌──────────────────────────────────────┐
│  state.age       (encrypted blob)    │
│  env-vars.age    (encrypted blob)    │
│  docker-state.age (encrypted blob)   │
│  mental-context.age (encrypted blob) │
│  services.age    (encrypted blob)    │
│  directories.age (encrypted blob)    │
│  manifest.json   (version + timestamps only) │
└──────────────────────────────────────┘
```

### Security Properties

✅ **Everything encrypted** - All state files encrypted with Age, not just secrets  
✅ **Encrypt-by-default** - Env vars encrypted unless explicitly safe-listed  
✅ **No password required** - Key-based encryption  
✅ **Post-quantum ready** - Age supports PQ algorithms  
✅ **Offline-first** - No API calls  
✅ **Zero trust** - Git remote compromise = attacker sees only ciphertext  
✅ **No side-channel leaks** - Secrets never in CLI args, shell history, or temp files  
✅ **Enforced file permissions** - Key files set to 600, config dirs to 700  
✅ **Transport security** - Git remote must use SSH or HTTPS  
✅ **Command confirmation** - Restored commands always shown for approval before execution  

### Encrypt-by-Default for Environment Variables

Instead of detecting secrets (error-prone), we encrypt **all** env vars and maintain a safe-list of values that *may* be stored in plaintext for convenience:

```javascript
// Safe-list: values that are NEVER secrets
// Everything else is encrypted by default
const SAFE_PLAINTEXT_KEYS = [
  'NODE_ENV', 'PORT', 'HOST', 'DEBUG',
  'LOG_LEVEL', 'TZ', 'LANG', 'SHELL',
  'EDITOR', 'TERM', 'COLORTERM',
  'CI', 'VERBOSE'
];

function shouldEncrypt(key, value) {
  // If on the safe-list AND value is non-sensitive, allow plaintext
  if (SAFE_PLAINTEXT_KEYS.includes(key.toUpperCase())) {
    // Double-check: even safe keys get encrypted if value looks sensitive
    if (hasHighEntropy(value) || containsCredentialPattern(value)) {
      return true;
    }
    return false;
  }
  // Everything else: ALWAYS encrypt
  return true;
}

// Shannon entropy check for high-randomness strings
function hasHighEntropy(value) {
  if (value.length < 16) return false;
  const freq = {};
  for (const ch of value) freq[ch] = (freq[ch] || 0) + 1;
  const len = value.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy > 4.0; // High entropy threshold
}

// Detect credentials embedded in URLs, PEM keys, JWTs, etc.
function containsCredentialPattern(value) {
  const patterns = [
    /^sk_/,                         // Stripe
    /^ghp_/,                        // GitHub PAT
    /^gho_/,                        // GitHub OAuth
    /^github_pat_/,                 // GitHub fine-grained PAT
    /^xoxb-/,                       // Slack bot
    /^xoxp-/,                       // Slack user
    /^AIza/,                        // Google API
    /^AKIA/,                        // AWS Access Key
    /^eyJ[A-Za-z0-9_-]+\./,        // JWT tokens
    /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/, // PEM private keys
    /-----BEGIN\s+CERTIFICATE-----/, // Certificates
    /:\/\/[^:]+:[^@]+@/,            // URLs with embedded credentials
    /^SG\./,                        // SendGrid
    /^AC[a-f0-9]{32}/,              // Twilio
    /^sk-[a-zA-Z0-9]{20,}/,        // OpenAI
  ];
  return patterns.some(p => p.test(value));
}
```

Users can customize the safe-list:
```bash
# View current safe-list
$ ctx-sync config safe-list

# Add a key to safe-list (stored plain)
$ ctx-sync config safe-list add MY_SAFE_VAR

# Remove from safe-list (will be encrypted on next sync)
$ ctx-sync config safe-list remove MY_SAFE_VAR
```

### Command Execution Safety

**Critical:** Restored services and Docker containers involve executing shell commands. To prevent remote code execution via a compromised Git repo, **all commands require explicit user confirmation before execution.**

```bash
$ ctx-sync restore my-app

✅ Restored: my-app

📂 Directory: ~/projects/my-app
🌿 Branch: feature/payments
🔐 Env vars: 12 decrypted

⚠️  The following commands will be executed:
┌────────────────────────────────────────────┐
│ 🐳 Docker services:                       │
│   1. docker compose up -d postgres         │
│   2. docker compose up -d redis            │
│                                            │
│ ⚡ Auto-start services:                    │
│   3. npm run dev (port 3000)               │
│                                            │
│ Review each command carefully!             │
└────────────────────────────────────────────┘

Execute all? [y/N/select] ▸

  y = run all    N = skip all    select = choose individually
```

If the user selects individually:
```bash
  [1] docker compose up -d postgres    [Y/n] y ✅
  [2] docker compose up -d redis       [Y/n] y ✅
  [3] npm run dev                      [Y/n] n ⏭️  Skipped
```

This prevents an attacker who compromises the Git remote from injecting malicious commands.

### Transport Security

The tool **enforces secure transport** for Git remotes:

```javascript
function validateRemoteUrl(url) {
  const insecurePatterns = [
    /^http:\/\//,       // Plaintext HTTP
    /^git:\/\//,        // Git protocol (no encryption)
    /^ftp:\/\//,        // FTP
  ];

  if (insecurePatterns.some(p => p.test(url))) {
    throw new Error(
      `Insecure Git remote: ${url}\n` +
      `ctx-sync requires SSH (git@...) or HTTPS (https://...) remotes.\n` +
      `Change your remote: git remote set-url origin <secure-url>`
    );
  }
}
```

Checked at:
- `ctx-sync init` (when setting up remote)
- `ctx-sync sync` / `push` / `pull` (on every operation)

### Key Management

#### File Permissions (Enforced at Runtime)

```javascript
const KEY_FILE_PERMS = 0o600;    // Owner read/write only
const CONFIG_DIR_PERMS = 0o700;  // Owner read/write/execute only

async function saveKey(dir, privateKey) {
  await fs.ensureDir(dir, { mode: CONFIG_DIR_PERMS });
  const keyPath = path.join(dir, 'key.txt');
  await fs.writeFile(keyPath, privateKey, { mode: KEY_FILE_PERMS });
}

async function loadKey(dir) {
  const keyPath = path.join(dir, 'key.txt');

  // Verify permissions before loading
  const stats = await fs.stat(keyPath);
  const mode = stats.mode & 0o777;
  if (mode !== KEY_FILE_PERMS) {
    throw new Error(
      `Key file has insecure permissions (${mode.toString(8)}). Expected 600.\n` +
      `Fix with: chmod 600 ${keyPath}`
    );
  }

  return fs.readFile(keyPath, 'utf-8');
}
```

#### Key Rotation

Built-in key rotation for when a key is suspected compromised:

```bash
$ ctx-sync key rotate

⚠️  Key Rotation
This will:
  1. Generate a new encryption key pair
  2. Re-encrypt ALL state files with the new key
  3. Rewrite Git history to remove old encrypted blobs
  4. Force-push to remote (old machines will need to re-pull)

Continue? [y/N] y

🔐 Generating new key pair...
✅ New public key: age1xyz789...
✅ New private key saved (permissions: 600)

🔄 Re-encrypting 6 state files...
✅ All files re-encrypted with new key

📦 Rewriting Git history...
✅ Old encrypted blobs removed from history

💾 Back up your NEW private key now:
❯ Save to 1Password/Bitwarden
  Copy to clipboard (clears after 30s)

⚠️  IMPORTANT: All other machines must run:
   $ ctx-sync key update
   Then paste the new private key.
```

#### Key Revocation (Teams)

When a team member leaves or a key is compromised:

```bash
$ ctx-sync team revoke age1bob...

⚠️  Revoking key: age1bob...
  1. Removing from recipient list
  2. Re-encrypting all shared secrets (without revoked key)
  3. Committing and syncing

✅ Key revoked. Bob can no longer decrypt new or existing secrets.
```

### Multi-Recipient Support (Teams)

```bash
# Team member A generates key
$ ctx-sync init
Public key: age1alice...

# Team member B generates key
$ ctx-sync init
Public key: age1bob...

# Verify keys out-of-band before trusting
$ ctx-sync team add --name "Bob" --key age1bob...

⚠️  Verify this key fingerprint with Bob:
   Fingerprint: A3:F2:9C:...
   Confirm? [y/N] y

✅ Bob added as team recipient

# Encrypt for both (automatic for team members)
$ ctx-sync sync
✅ Encrypted for 2 recipients
```

**Team security features:**
- Key verification via fingerprint exchange (out-of-band)
- Access revocation with automatic re-encryption
- Audit log of who was added/removed and when
- Per-project recipient control (not all members see all projects)

### Preventing Side-Channel Leaks

#### No Secrets in CLI Arguments

Secrets are **never** accepted as command-line arguments (visible in `ps aux` and shell history):

```bash
# BAD (old approach - removed):
# ctx-sync env add STRIPE_KEY=sk_live_abc123

# GOOD: Interactive prompt (not in shell history)
$ ctx-sync env add STRIPE_KEY
Enter value: ******** (hidden input)
✅ Encrypted and saved

# GOOD: Pipe from stdin
$ echo "sk_live_abc123" | ctx-sync env add STRIPE_KEY --stdin

# GOOD: Read from file descriptor
$ ctx-sync env add STRIPE_KEY --from-fd 3 3< <(pass show stripe-key)
```

#### Secure Memory Handling

```javascript
// Clear secrets from memory after use
function withSecret(secretBuffer, fn) {
  try {
    return fn(secretBuffer);
  } finally {
    // Zero out the buffer
    secretBuffer.fill(0);
  }
}
```

#### No Temporary Files for Secrets

All encryption/decryption operations happen **in memory only**. Secrets are never written to temporary files, even during crypto operations.

#### Log Sanitization

```javascript
function sanitizeForLog(message) {
  // Redact anything that looks like a secret value
  return message
    .replace(/sk_[a-zA-Z0-9_]+/g, 'sk_***REDACTED***')
    .replace(/ghp_[a-zA-Z0-9]+/g, 'ghp_***REDACTED***')
    .replace(/(password|secret|token|key)=\S+/gi, '$1=***REDACTED***')
    .replace(/-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, '***REDACTED_KEY***');
}
```

Debug mode (`DEBUG=*`) never outputs decrypted secret values.

---

## Environment Variable Handling

### Zero Manual Entry!

**Users do NOT enter secrets one-by-one!**

### Security Model: Encrypt by Default

All environment variables are **encrypted by default**. Only values on an explicit safe-list (e.g., `NODE_ENV`, `PORT`) may be stored in plaintext. This eliminates the risk of false-negative secret detection.

### Import Methods

#### Method 1: Import .env File (Recommended)
```bash
$ ctx-sync env import my-app .env

🔍 Scanning .env file...

Found 12 environment variables:
  🔐 All 12 will be encrypted (encrypt-by-default)
  💡 3 are on the safe-list and could be stored plain:
     NODE_ENV, PORT, DEBUG
  
  Use --allow-plain to store safe-listed values unencrypted

Import all? [Y/n] y

✅ Imported 12 env vars (all encrypted)
```

#### Method 2: Scan Current Environment
```bash
$ ctx-sync env scan my-app

🔍 Scanning current shell...

Found 23 env vars. Track which?
❯ ◉ Project-related (8 detected)
  ◯ All (23)
  ◯ Manual selection

✅ Added 8 env vars (all encrypted)
```

#### Method 3: Interactive Add (Secure)
```bash
# Secrets are NEVER passed as CLI arguments
$ ctx-sync env add my-app STRIPE_KEY
Enter value: ******** (hidden input)
✅ Encrypted and saved

# Or pipe from stdin
$ cat .env | ctx-sync env import my-app --stdin

# Or from a password manager
$ ctx-sync env add my-app STRIPE_KEY --from-fd 3 3< <(pass show stripe-key)
```

> **Security:** Secrets are never accepted as command-line arguments. CLI arguments are visible in `ps aux` output and shell history (`~/.zsh_history`). Values must be entered via interactive prompt, stdin pipe, or file descriptor.

### Safe-List Configuration

```javascript
// Built-in safe-list: keys that may be stored as plaintext
// ONLY if --allow-plain flag is used during import
const DEFAULT_SAFE_LIST = [
  'NODE_ENV', 'PORT', 'HOST', 'DEBUG',
  'LOG_LEVEL', 'TZ', 'LANG', 'SHELL',
  'EDITOR', 'TERM', 'COLORTERM',
  'CI', 'VERBOSE'
];

// Users can extend the safe-list per-project
// ctx-sync config safe-list add MY_SAFE_VAR
// ctx-sync config safe-list remove PORT
```

**Default behavior:** Everything encrypted. The safe-list only takes effect when the user explicitly opts in with `--allow-plain`.

---

## Implementation Plan

### Phase 1: MVP (Week 1-2)

**Core functionality:**
- [x] Git-based sync (simple-git)
- [x] Project state tracking
- [x] Full state encryption (all `.age` files)
- [x] Encrypt-by-default for env vars
- [x] Basic CLI (commander)
- [x] .env file import (via stdin/prompt, no CLI args for values)

**Deliverable:** `ctx-sync init`, `track`, `sync`, `restore`

### Phase 2: Docker + Mental Context + Security Hardening (Week 3)

**Features:**
- [x] Docker compose state tracking
- [x] Mental context (tasks, blockers, breadcrumbs)
- [x] Service state (ports, commands)
- [x] Command confirmation on restore (RCE prevention)
- [x] Transport security enforcement (SSH/HTTPS only)
- [x] Key file permission enforcement (600/700)
- [x] Path validation and sanitization

**Deliverable:** Full context restoration with security guarantees

### Phase 3: Polish, Security & UX (Week 4)

**Improvements:**
- [x] Interactive wizards
- [x] Better error messages
- [x] Auto-detection improvements
- [x] Key rotation (`ctx-sync key rotate`)
- [x] Security audit command (`ctx-sync audit`)
- [x] Log sanitization
- [x] Documentation (including security model)

**Deliverable:** Production-ready v1.0

### Phase 4: V2 Features (Post-launch)

**Features:**
- [ ] Tmux session templates
- [ ] Git worktrees support
- [ ] Tool version management
- [ ] IDE settings sync

---

## User Experience

### First-Time Setup (30 seconds)

```bash
$ npm install -g ctx-sync

$ ctx-sync init

Welcome to ctx-sync! 🚀

🔐 Generating encryption key...
✅ Public key:  age1abc123...
✅ Private key saved to: ~/.config/ctx-sync/key.txt
   Permissions: 600 (owner read/write only)

⚠️  IMPORTANT: Back up your private key NOW!

💾 Backup method:
❯ Save to 1Password/Bitwarden
  Copy to clipboard (auto-clears in 30s)
  Skip (--skip-backup required, not recommended)

[User saves to 1Password]

📦 Create Git repo for syncing:
  Repository URL: git@github.com:user/dev-context.git

⚠️  Validating remote security...
✅ SSH transport detected (secure)

✅ All set!

Now track your first project:
$ cd ~/projects/my-app
$ ctx-sync track
```

### Tracking a Project

```bash
$ cd ~/projects/my-app
$ ctx-sync track

✅ Tracking: my-app
📍 Path: ~/projects/my-app
🌿 Branch: feature/payments

🔍 Found .env file. Import? [Y/n] y
✅ Imported 12 env vars (all encrypted by default)

🐳 Found docker-compose.yml
   Track services? [Y/n] y
✅ Tracking: postgres, redis

💡 What are you working on?
Current task: Implementing Stripe webhooks

Next steps (optional):
1. Test with Stripe CLI
2. Add error handling

✅ Project tracked!

🔐 Encrypting all state files...
Sync to Git? [Y/n] y
✅ Synced to GitHub (all data encrypted)
```

### Daily Usage

```bash
# Work on project...
$ cd ~/projects/my-app
$ npm run dev

# Auto-save (background)
# Or manual: ctx-sync save

# Push changes
$ ctx-sync sync
✅ Synced 3 projects
```

### New Machine Setup (15 seconds)

```bash
$ npm install -g ctx-sync

$ ctx-sync init --restore

🔑 Restore encryption key:
[Paste from 1Password]

✅ Key restored (permissions set to 600)

📥 Clone your context repo:
  Repository: git@github.com:user/dev-context.git

⚠️  Validating remote security...
✅ SSH transport detected (secure)

🔐 Decrypting state files...
✅ Found 3 projects:
   - my-app (12 env vars, 2 services)
   - api-server (8 env vars)
   - frontend (5 env vars)

All state decrypted! 🎉
```

### Restoring a Project

```bash
$ ctx-sync restore my-app

🔐 Decrypting state files...
✅ Restored: my-app

📂 Directory: ~/projects/my-app
🌿 Branch: feature/payments
🔐 Env vars: 12 decrypted

📝 You were working on:
   "Implementing Stripe webhooks"
   
   Last file: src/webhooks/stripe.ts:45
   
   Next steps:
   • Test with Stripe CLI
   • Add error handling

⚠️  The following commands will be executed:
┌────────────────────────────────────────────┐
│ 🐳 Docker services:                       │
│   1. docker compose up -d postgres         │
│      Image: postgres:15, Port: 5432        │
│   2. docker compose up -d redis            │
│      Image: redis:7-alpine, Port: 6379     │
│                                            │
│ ⚡ Auto-start services:                    │
│   3. npm run dev (port 3000)               │
│      Working dir: ~/projects/my-app        │
│                                            │
│ Review each command carefully!             │
└────────────────────────────────────────────┘

Execute all? [y/N/select]

  y = run all    N = skip all    select = choose individually

> y

   ✓ postgres started (port 5432)
   ✓ redis started (port 6379)
   ✓ dev server started (port 3000)

Ready to work! 🚀
```

> **Security:** Commands are **always** shown for explicit approval before execution. This prevents remote code execution if the Git repo is compromised. Even if an attacker modifies `services.age` or `docker-state.age`, the user sees exactly what will run and can reject suspicious commands.

### Mental Context Updates

```bash
$ ctx-sync note my-app

What's your current status?

Current task: Implementing Stripe webhooks
Blockers: Waiting for staging API keys
Next steps: 
  1. Test webhook signatures
  2. Handle duplicate events

Links (optional):
  - https://stripe.com/docs/webhooks

✅ Context updated
```

---

## CLI Commands Reference

### Setup
```bash
ctx-sync init                    # First time setup
ctx-sync init --restore          # Setup on new machine
```

### Project Management
```bash
ctx-sync track                   # Track current project
ctx-sync list                    # List all tracked projects
ctx-sync status                  # Show sync status
ctx-sync restore <project>       # Restore project state (with command confirmation)
```

### Environment Variables
```bash
ctx-sync env import <file>       # Import from .env (all encrypted by default)
ctx-sync env import --stdin       # Import from stdin pipe
ctx-sync env scan                # Scan current environment
ctx-sync env add <key>           # Add single var (interactive prompt, hidden input)
ctx-sync env add <key> --stdin   # Add single var from stdin
ctx-sync env add <key> --from-fd N  # Add from file descriptor
ctx-sync env list <project>      # List all vars (values hidden)
ctx-sync env list --show-values  # List with decrypted values (use with caution)
```

> **Security:** `ctx-sync env add` never accepts values as command-line arguments. Values are read from interactive prompt (hidden input), stdin, or file descriptors to prevent exposure in shell history and process lists.

### Syncing
```bash
ctx-sync sync                    # Push/pull changes
ctx-sync pull                    # Pull only
ctx-sync push                    # Push only
```

### Mental Context
```bash
ctx-sync note <project>          # Update task/notes
ctx-sync show <project>          # Show full context
```

### Docker
```bash
ctx-sync docker start <project>  # Start tracked services (with confirmation)
ctx-sync docker stop <project>   # Stop services
ctx-sync docker status           # Show running services
```

### Key Management
```bash
ctx-sync key show                # Show public key (never shows private key)
ctx-sync key rotate              # Rotate key + re-encrypt all state
ctx-sync key verify              # Verify key file permissions & integrity
ctx-sync key update              # Update private key on this machine (after rotation)
```

### Team Management
```bash
ctx-sync team add --name <n> --key <pubkey>   # Add team member
ctx-sync team remove <name>      # Remove team member + re-encrypt
ctx-sync team list               # List team members & keys
ctx-sync team revoke <pubkey>    # Revoke a key immediately
```

### Security & Config
```bash
ctx-sync config safe-list        # View env var safe-list
ctx-sync config safe-list add <key>    # Add key to safe-list
ctx-sync config safe-list remove <key> # Remove key from safe-list
ctx-sync audit                   # Run security audit (permissions, transport, etc.)
```

---

## Success Metrics

### User Metrics
- **Time to setup new machine:** < 1 minute
- **Time to restore project:** < 10 seconds
- **Manual secret entry:** 0 (import from .env)
- **Context switch recovery:** < 2 minutes (vs 23 min baseline)

### Technical Metrics
- **Sync speed:** < 3 seconds
- **Encryption overhead:** < 100ms per secret
- **Storage size:** < 1MB per 100 projects
- **Cross-platform:** macOS, Linux, Windows (WSL)

---

## Competitive Advantages

### vs Atuin
✅ We sync full dev context, not just shell history  
✅ Project-centric vs command-centric  
✅ Docker + mental context included  

### vs Dotfiles Managers
✅ We sync state, not just config  
✅ Secrets encrypted (they don't handle this)  
✅ Per-project context, not global only  

### vs Cloud IDEs
✅ Works with local tools  
✅ No vendor lock-in  
✅ Own your data  
✅ Works offline  

---

## Monetization Strategy (Future)

### Free Tier (Forever)
- Git-based sync (user's own repo)
- All core features
- Unlimited projects
- Age encryption

### Pro Tier ($5/month)
- Managed sync server (no Git needed)
- Web dashboard
- Team collaboration
- Advanced analytics
- Priority support

### Enterprise ($50/user/month)
- SSO/SAML
- Audit logs
- Admin controls
- Self-hosted option
- Custom integrations

**Start 100% free, monetize later!**

---

## Risk Mitigation

### Risk: Users lose encryption key

**Severity:** Critical  
**Impact:** Permanent loss of all encrypted state

**Mitigation:**
- Force backup during init (cannot skip without explicit `--skip-backup`)
- Integration with 1Password/Bitwarden CLI for direct storage
- Clipboard copy with 30-second auto-clear
- Clear warnings throughout the process
- `ctx-sync key verify` command to check key health

### Risk: Remote code execution via compromised Git repo

**Severity:** Critical  
**Impact:** Arbitrary command execution on user's machine

**Mitigation:**
- **All restored commands require explicit user confirmation** before execution
- Full state encryption prevents attackers from modifying state without the key
- Commands are displayed in full before approval (not truncated)
- No `--yes` or `--no-confirm` flag for command execution (cannot be bypassed)
- Docker image names shown explicitly so users can spot malicious substitutions

### Risk: Secrets leaked to Git

**Severity:** Critical  
**Impact:** Permanent exposure of credentials in Git history

**Mitigation:**
- **Encrypt-by-default** for all env vars (no false-negative risk)
- **Full state encryption** for all state files (no metadata leakage)
- Pre-commit hooks verify no plaintext secrets exist
- `ctx-sync audit` command scans Git history for accidental leaks
- Git history rewriting on key rotation

### Risk: Secrets leaked via side channels

**Severity:** High  
**Impact:** Credentials exposed in shell history, process lists, logs

**Mitigation:**
- Secrets never accepted as CLI arguments
- Interactive prompts use hidden input
- Stdin/file descriptor input for automation
- Log sanitization removes secret-like patterns
- Debug mode never outputs decrypted values
- No temporary files during crypto operations (memory-only)

### Risk: Private key compromise

**Severity:** High  
**Impact:** All current and historical encrypted state exposed

**Mitigation:**
- Key file permissions enforced at 600 (checked on every load)
- Config directory permissions enforced at 700
- Built-in key rotation command (`ctx-sync key rotate`)
- Git history rewriting removes old encrypted blobs on rotation
- Team key revocation with automatic re-encryption
- QR code display removed (screen capture risk)

### Risk: Insecure Git transport

**Severity:** High  
**Impact:** All synced data (including ciphertext) exposed to MITM

**Mitigation:**
- Remote URL validation on every sync operation
- Only SSH (`git@`) and HTTPS (`https://`) allowed
- HTTP, Git protocol, and FTP are blocked with clear error messages
- Checked at `init`, `sync`, `push`, and `pull`

### Risk: Team member departure / insider threat

**Severity:** Medium  
**Impact:** Former member retains access to shared secrets

**Mitigation:**
- Key revocation command (`ctx-sync team revoke`)
- Automatic re-encryption of all shared state on revocation
- Key verification via fingerprint exchange (prevents impersonation)
- Per-project recipient control (not all members see all projects)
- Audit log of key additions/removals

### Risk: Merge conflicts overwrite security state

**Severity:** Medium  
**Impact:** Silently revert a rotated secret or security change

**Mitigation:**
- Encrypted state files use timestamp-based conflict detection
- Conflicts in encrypted state require explicit resolution (no auto-merge)
- Warning displayed when a sync would overwrite newer encrypted data
- Merge conflict on `env-vars.age` always prompts the user

### Risk: Git repo gets huge

**Severity:** Low  
**Impact:** Slow syncs, storage waste

**Mitigation:**
- Encrypted blobs are compact (Age output is efficient)
- Git history rewriting on key rotation prunes old blobs
- `ctx-sync audit` reports repo size and recommends cleanup
- Size warnings at configurable thresholds

### Risk: Path traversal in restored state

**Severity:** Medium  
**Impact:** Operations in unintended directories

**Mitigation:**
- All paths validated and canonicalized before use
- Paths must be within `$HOME` or explicitly approved directories
- Symlinks are not followed for path resolution
- Suspicious paths (e.g., `/etc/`, `/usr/`) are rejected

---

## Development Roadmap

### Q1 2025: MVP Launch
- Core features (P0)
- macOS + Linux support
- NPM package
- Documentation

### Q2 2025: V2 Features
- Terminal sessions
- Tool version management
- Windows (WSL) support
- VSCode extension

### Q3 2025: Integrations
- 1Password CLI
- GitHub CLI
- Atuin integration
- direnv support

### Q4 2025: Pro Tier
- Managed sync service
- Web dashboard
- Team features
- Analytics

---

## Technical Decisions

### Why Git?
- ✅ Developers already have it
- ✅ Free, distributed, reliable
- ✅ Version history built-in
- ✅ Works offline
- ✅ No infrastructure costs

### Why Age encryption?
- ✅ Modern, simple, audited
- ✅ Better than GPG (no configuration complexity)
- ✅ Multi-recipient support (teams)
- ✅ Post-quantum ready
- ✅ NPM package available
- ✅ Supports full file encryption (not just individual values)

### Why encrypt everything (not just secrets)?
- ✅ Eliminates false-negative risk in secret detection
- ✅ Prevents metadata leakage (project names, paths, infrastructure details)
- ✅ Simplifies the security model (encrypt everything vs. classify each value)
- ✅ Git remote compromise reveals nothing useful
- ⚠️ Trade-off: Git diffs are no longer human-readable (acceptable for security)

### Why Node.js?
- ✅ Cross-platform
- ✅ NPM distribution
- ✅ Rich ecosystem
- ✅ Easy for contributors

### Why .age files (not JSON)?
- On disk and in Git, files are encrypted `.age` blobs
- In memory, data is structured JSON for easy manipulation
- JSON is never written to disk in plaintext (except `manifest.json` which has no sensitive data)
- ✅ Security-first: encrypted at rest
- ✅ Simple: one blob per state file

---

## Open Questions

1. **Shell integration:** Should we auto-save on `cd`? (Security note: must not log paths to shell history)
2. **Frequency:** Auto-sync every N minutes or manual only?
3. **Conflicts:** How aggressive should conflict resolution be? (Encrypted files need special handling)
4. **Atuin:** Integrate or build separate shell history?
5. **IDE plugins:** Build VSCode extension or CLI-only?
6. **Key escrow:** Should we offer optional key escrow for users who lose their key? (Trade-off: convenience vs. trust)
7. **Hardware key support:** Should we support YubiKey/hardware tokens for key storage?
8. **Audit logging:** How verbose should the security audit log be?

---

## Conclusion

**Context Sync** solves a real problem that affects millions of developers daily. By leveraging Git + age encryption, we can build this **without any backend infrastructure** while maintaining security and simplicity.

### Next Steps

1. ✅ Build MVP (Weeks 1-2)
2. ✅ Beta test with 10 developers
3. ✅ Launch on Product Hunt
4. ✅ Submit to Hacker News
5. ✅ Build community

### Success Looks Like

- **1,000 stars** on GitHub in first month
- **100 active users** in first quarter
- **10% reduction** in context switch time
- **Zero security incidents**

Let's build this! 🚀

---

## Appendix

### Example State Files

> **All `.age` files are encrypted blobs on disk and in Git.** The JSON structures below show the **decrypted in-memory representation** only. These are never written to disk in plaintext.

#### manifest.json (only plaintext file in Git)
```json
{
  "version": "1.0.0",
  "lastSync": "2025-02-10T14:30:00Z",
  "files": {
    "state.age": { "lastModified": "2025-02-10T14:30:00Z" },
    "env-vars.age": { "lastModified": "2025-02-10T14:28:00Z" },
    "docker-state.age": { "lastModified": "2025-02-10T09:00:00Z" },
    "mental-context.age": { "lastModified": "2025-02-10T14:25:00Z" },
    "services.age": { "lastModified": "2025-02-10T09:00:00Z" },
    "directories.age": { "lastModified": "2025-02-10T14:00:00Z" }
  }
}
```

> **Note:** `manifest.json` contains only version and timestamps. No project names, paths, hostnames, or other identifying information.

#### state.age (decrypted in-memory structure)
```json
{
  "machine": {
    "id": "macbook-pro-2023",
    "hostname": "johns-mbp.local"
  },
  "projects": [
    {
      "id": "my-app",
      "name": "my-app",
      "path": "~/projects/my-app",
      "git": {
        "branch": "feature/payments",
        "remote": "origin",
        "hasUncommitted": true,
        "stashCount": 2
      },
      "lastAccessed": "2025-02-10T14:30:00Z"
    }
  ]
}
```

#### env-vars.age (decrypted in-memory structure)
```json
{
  "my-app": {
    "NODE_ENV": {
      "value": "development",
      "addedAt": "2025-02-10T10:00:00Z"
    },
    "PORT": {
      "value": "3000",
      "addedAt": "2025-02-10T10:00:00Z"
    },
    "STRIPE_KEY": {
      "value": "sk_live_abc123",
      "addedAt": "2025-02-10T10:00:00Z"
    },
    "DATABASE_URL": {
      "value": "postgres://user:pass@localhost:5432/db",
      "addedAt": "2025-02-10T10:00:00Z"
    }
  }
}
```

> **Note:** ALL env vars are encrypted together in the `.age` blob. There is no distinction between "plain" and "secret" in the encrypted file. The entire file is one Age-encrypted payload. The `hint` field has been removed to prevent metadata leakage.

#### mental-context.age (decrypted in-memory structure)
```json
{
  "my-app": {
    "currentTask": "Implementing Stripe webhook handlers",
    "lastWorkingOn": {
      "file": "src/webhooks/stripe.ts",
      "line": 45,
      "column": 12,
      "description": "Adding signature verification",
      "timestamp": "2025-02-10T14:25:00Z"
    },
    "blockers": [
      {
        "description": "Waiting for staging API keys from ops",
        "addedAt": "2025-02-09T15:00:00Z",
        "priority": "high"
      }
    ],
    "nextSteps": [
      "Test webhook with Stripe CLI",
      "Add error handling for invalid signatures",
      "Update documentation"
    ],
    "relatedLinks": [
      {
        "title": "Stripe Webhooks Docs",
        "url": "https://stripe.com/docs/webhooks"
      },
      {
        "title": "PR #789",
        "url": "https://github.com/company/repo/pull/789"
      }
    ],
    "breadcrumbs": [
      {
        "note": "Started at line 23 - added webhook route",
        "timestamp": "2025-02-10T09:00:00Z"
      },
      {
        "note": "TODO: Need to handle edge case for duplicate events",
        "timestamp": "2025-02-10T11:30:00Z"
      }
    ]
  }
}
```

#### docker-state.age (decrypted in-memory structure)
```json
{
  "my-app": {
    "composeFile": "~/projects/my-app/docker-compose.yml",
    "services": [
      {
        "name": "postgres",
        "container": "my-app-db",
        "image": "postgres:15",
        "port": 5432,
        "volumes": ["postgres_data:/var/lib/postgresql/data"],
        "autoStart": true,
        "healthCheck": "pg_isready"
      },
      {
        "name": "redis",
        "container": "my-app-redis",
        "image": "redis:7-alpine",
        "port": 6379,
        "autoStart": true
      }
    ],
    "networks": ["my-app-network"],
    "lastStarted": "2025-02-10T09:00:00Z"
  }
}
```

> **Security reminder:** Even though `autoStart: true` is set, these services will **never** start without explicit user confirmation during `ctx-sync restore`.

---

**Document Version:** 1.0  
**Last Updated:** 2025-02-10  
**Author:** Context Sync Team  
**License:** MIT