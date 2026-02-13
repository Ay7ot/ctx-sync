# Security Model

ctx-sync is designed with a zero-trust, encrypt-everything approach. This document explains the security architecture, threat model, and key management.

## Core Principles

1. **Encrypt everything by default** — All state files are encrypted with Age. Not just secrets — project names, paths, Docker config, and mental context are all encrypted.
2. **No backend required** — Git is the only transport. You control your data.
3. **Zero trust** — A compromised Git remote reveals only ciphertext.
4. **No side-channel leaks** — Secrets never appear in CLI arguments, shell history, process lists, or log output.
5. **Command confirmation** — Restored commands always require explicit user approval before execution.

## Threat Model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Git remote compromise | Critical | Full state encryption — attacker sees only ciphertext |
| Private key compromise | Critical | Key rotation with history rewrite; team key revocation |
| Local machine compromise | High | File permissions enforced (600/700); encrypted at rest |
| Man-in-the-Middle | High | Transport security — only SSH and HTTPS remotes allowed |
| Shoulder surfing | Medium | Hidden input for secrets; no QR code display |
| Side-channel leakage | Medium | No secrets in CLI args, logs, or temp files |
| Insider threat (teams) | Medium | Key revocation with automatic re-encryption |

## Encryption Architecture

### Why Age?

ctx-sync uses [Age encryption](https://age-encryption.org/) because it is:

- **Modern and audited** — Designed by Filippo Valsorda
- **Simple** — No configuration complexity (unlike GPG)
- **Multi-recipient** — Built-in support for team encryption
- **Post-quantum ready** — Supports post-quantum algorithms

### What Gets Encrypted

Every state file is encrypted as a single Age blob:

```
~/.context-sync/
├── manifest.json       # ONLY plaintext file (version + timestamps)
├── state.age           # Encrypted: projects, branches, paths
├── env-vars.age        # Encrypted: ALL environment variables
├── docker-state.age    # Encrypted: container configurations
├── mental-context.age  # Encrypted: tasks, blockers, breadcrumbs
├── services.age        # Encrypted: running services, commands
└── directories.age     # Encrypted: recent and pinned directories
```

The `manifest.json` file contains only version and timestamps — no project names, paths, or hostnames.

### Encrypt-by-Default for Environment Variables

Instead of trying to detect which values are secrets (error-prone), ctx-sync encrypts **all** environment variables by default. This eliminates false-negative risk.

A safe-list of known non-sensitive keys (like `NODE_ENV`, `PORT`, `DEBUG`) can optionally be stored as plaintext, but only when the user explicitly opts in with `--allow-plain`.

## Key Management

### Key Storage

- Private key: `~/.config/ctx-sync/key.txt` (permissions: 600)
- Config directory: `~/.config/ctx-sync/` (permissions: 700)
- The config directory is **never** committed to Git

### Key Rotation

If a key is suspected compromised:

```bash
ctx-sync key rotate
```

This will:
1. Generate a new key pair
2. Re-encrypt all state files
3. Rewrite Git history to remove old encrypted blobs
4. Force-push to remote

All other machines must then run `ctx-sync key update` and paste the new private key.

### Key Verification

```bash
ctx-sync key verify
```

Checks that key file permissions are correct and the key is valid.

## Transport Security

ctx-sync enforces secure transport for all Git operations. Only SSH and HTTPS remotes are allowed. HTTP, Git protocol, and FTP are blocked.

Transport is validated at:
- `ctx-sync init` (when setting up remote)
- `ctx-sync sync` / `push` / `pull` (on every operation)

## Command Execution Safety

When restoring a project, any commands (Docker services, auto-start services) are shown for explicit user approval before execution. This prevents remote code execution if the Git repo is compromised.

```
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
Execute all? [y/N/select]
```

There is **no flag** to skip command confirmation. Even `--yes` does not bypass this safety check.

## Side-Channel Prevention

### No Secrets in CLI Arguments

Secrets are never accepted as command-line arguments. CLI arguments are visible in `ps aux` and shell history. Values must be entered via:

- Interactive prompt (hidden input)
- stdin pipe
- File descriptor

### Log Sanitization

All log output is sanitized to remove patterns that look like secrets (API keys, tokens, credentials in URLs).

### No Temporary Files

Encryption and decryption happen entirely in memory. Secrets are never written to temporary files.

### Secure Memory

Secret buffers are zeroed after use to prevent memory inspection attacks.

## Security Audit

Run `ctx-sync audit` to check your setup:

- Key file permissions
- Config directory permissions
- Remote transport security
- Git history for plaintext leaks
- Repository size
- State file encryption verification
