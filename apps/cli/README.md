# ctx-sync

> Sync your complete development context across machines using Git as the backend.

[![npm version](https://img.shields.io/npm/v/ctx-sync.svg)](https://www.npmjs.com/package/ctx-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**ctx-sync** is a CLI tool that solves the "23-minute context switch" problem by preserving and restoring your entire development state — projects, environment variables, Docker services, mental context, and more — across machines.

## The Problem

Research shows developers lose **23 minutes** regaining flow state after interruptions. When switching between machines, they face:

- Lost project state (which repos, branches)
- Missing environment variables
- Forgotten running services
- Lost mental context (what was I working on?)
- Manual reconfiguration of Docker containers

**ctx-sync fixes all of this in under 10 seconds.**

## Key Features

- **No backend required** — Uses Git for syncing (GitHub, GitLab, any Git host)
- **Everything encrypted** — Full state encryption with [Age](https://age-encryption.org/)
- **Encrypt-by-default** — All env vars encrypted, eliminating false negatives
- **Zero manual entry** — Import from `.env` files in batch
- **Zero side-channel leaks** — No secrets in CLI args, shell history, or logs
- **Mental state preserved** — Track tasks, blockers, breadcrumbs
- **Team support** — Multi-recipient encryption for shared environments

## Installation

```bash
npm install -g ctx-sync
```

**Requirements:** Node.js >= 20.0.0, Git >= 2.25

## Quick Start

### 1. First-time setup

```bash
ctx-sync init
```

This generates an encryption key, sets up a Git-backed sync repo, and prompts you to back up your private key to a password manager.

### 2. Track a project

```bash
cd ~/projects/my-app
ctx-sync track
```

ctx-sync auto-detects your Git branch, `.env` files, `docker-compose.yml`, and prompts you for mental context (what are you working on?).

### 3. Sync to remote

```bash
ctx-sync sync
```

All state is encrypted, committed to Git, and pushed to your remote.

### 4. Restore on another machine

```bash
# One-time setup on the new machine
ctx-sync init --restore
# Paste your private key from your password manager

# Restore a specific project
ctx-sync restore my-app
```

ctx-sync decrypts your state, displays your context, and asks before running any commands.

If your project is at a different path on the new machine, use `--path`:

```bash
ctx-sync restore my-app --path ~/code/my-app
```

## What Gets Tracked

| State | Description |
|-------|-------------|
| **Project state** | Git branch, remote, stash count, uncommitted changes |
| **Environment variables** | All vars from `.env` files, encrypted by default |
| **Docker services** | Compose services, ports, images, healthchecks |
| **Mental context** | Current task, blockers, next steps, breadcrumbs |
| **Running services** | Dev servers, ports, start commands |
| **Working directories** | Recent and pinned directories with frequency tracking |

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `ctx-sync init` | First-time setup — generates key, creates Git repo |
| `ctx-sync init --restore` | Setup on new machine with existing key |

### Project Management

| Command | Description |
|---------|-------------|
| `ctx-sync track` | Track current project (interactive wizard) |
| `ctx-sync list` | List all tracked projects |
| `ctx-sync status` | Show sync status |
| `ctx-sync restore <project>` | Restore project state (with command confirmation) |
| `ctx-sync restore <project> --path <dir>` | Restore with custom local project directory |

### Environment Variables

| Command | Description |
|---------|-------------|
| `ctx-sync env import <file>` | Import from .env file (all encrypted) |
| `ctx-sync env add <key>` | Add single var (hidden interactive prompt) |
| `ctx-sync env add <key> --stdin` | Add from stdin pipe |
| `ctx-sync env scan` | Scan current shell environment |
| `ctx-sync env list <project>` | List vars (values hidden by default) |
| `ctx-sync env list <project> --show-values` | List with decrypted values |

### Syncing

| Command | Description |
|---------|-------------|
| `ctx-sync sync` | Push and pull changes |
| `ctx-sync push` | Push only |
| `ctx-sync pull` | Pull only |

### Mental Context

| Command | Description |
|---------|-------------|
| `ctx-sync note <project>` | Update tasks, blockers, next steps |
| `ctx-sync show <project>` | Show full project context |

### Docker

| Command | Description |
|---------|-------------|
| `ctx-sync docker track` | Detect and save Docker Compose state |
| `ctx-sync docker start <project>` | Start tracked services (with confirmation) |
| `ctx-sync docker stop <project>` | Stop tracked services |
| `ctx-sync docker status` | Show running services |

### Key Management

| Command | Description |
|---------|-------------|
| `ctx-sync key show` | Show public key (never shows private key) |
| `ctx-sync key rotate` | Rotate key and re-encrypt all state |
| `ctx-sync key verify` | Verify key file permissions and integrity |
| `ctx-sync key update` | Update key on secondary machines after rotation |

### Teams

| Command | Description |
|---------|-------------|
| `ctx-sync team add --name <n> --key <pubkey>` | Add team member |
| `ctx-sync team remove <name>` | Remove member and re-encrypt |
| `ctx-sync team list` | List team members |
| `ctx-sync team revoke <pubkey>` | Revoke key immediately |

### Security & Config

| Command | Description |
|---------|-------------|
| `ctx-sync audit` | Run security audit (permissions, transport, history) |
| `ctx-sync config safe-list` | View env var safe-list |
| `ctx-sync config safe-list add <key>` | Add key to safe-list |
| `ctx-sync config safe-list remove <key>` | Remove key from safe-list |

## Security Model

ctx-sync takes a **defense-in-depth** approach to security:

### Encrypt Everything by Default

All state files are encrypted with [Age](https://age-encryption.org/) before being written to disk or committed to Git. The only plaintext file is `manifest.json`, which contains only version and timestamps — no project names, paths, or sensitive data.

### What Gets Encrypted

| File | Contents |
|------|----------|
| `state.age` | Projects, branches, Git metadata |
| `env-vars.age` | All environment variables |
| `docker-state.age` | Container configurations |
| `mental-context.age` | Tasks, blockers, breadcrumbs |
| `services.age` | Running services and commands |
| `directories.age` | Recent and pinned directories |

### Security Properties

- **Zero trust** — Git remote compromise reveals only ciphertext
- **No side-channel leaks** — Secrets never in CLI args, shell history, or logs
- **Transport security** — Git remote must use SSH or HTTPS (enforced at runtime)
- **Command confirmation** — Restored commands always shown before execution
- **File permissions** — Key: `0o600`, config dir: `0o700` (enforced at runtime)
- **Key rotation** — Built-in rotation with Git history rewriting
- **Team revocation** — Remove member access with automatic re-encryption
- **Credential detection** — Recognizes Stripe, GitHub, AWS, Slack, Google, JWT, PEM, and more
- **Log sanitization** — Secret patterns automatically redacted from all output

## Architecture

```
~/.context-sync/            # Git repo (syncs to remote)
├── manifest.json           # Version + timestamps (only plaintext)
├── state.age               # Encrypted: projects & branches
├── env-vars.age            # Encrypted: all environment variables
├── docker-state.age        # Encrypted: container configurations
├── mental-context.age      # Encrypted: tasks, blockers, breadcrumbs
├── services.age            # Encrypted: running services & commands
└── directories.age         # Encrypted: recent & pinned directories

~/.config/ctx-sync/         # Local config (NEVER synced to Git)
├── key.txt                 # Private key (permissions: 600)
├── config.json             # Local preferences, safe-list
└── approved-commands.json  # Per-machine approved command cache
```

## Example Workflow

### Morning on your work laptop

```bash
cd ~/projects/my-app
ctx-sync track

# ctx-sync detects:
#   Branch: feature/payments
#   .env: 12 variables imported (all encrypted)
#   Docker: postgres, redis tracked
#   You add: "Implementing Stripe webhooks"

ctx-sync sync   # Encrypted + pushed to Git
```

### Evening on your home desktop

```bash
ctx-sync init --restore   # One-time: paste key from 1Password
ctx-sync restore my-app

# Output:
#   Directory: ~/projects/my-app
#   Branch: feature/payments
#   Env vars: 12 decrypted
#   You were working on: "Implementing Stripe webhooks"
#   Next steps: Test with Stripe CLI, Add error handling
#
#   Commands to execute:
#     1. docker compose up -d postgres
#     2. docker compose up -d redis
#     3. npm run dev (port 3000)
#   Execute all? [y/N/select]
```

Back to full flow in under 10 seconds.

## Why ctx-sync?

| | ctx-sync | Atuin | Dotfile managers | Cloud IDEs |
|---|---------|-------|-----------------|------------|
| Project state | **Yes** | No | No | Partial |
| Environment variables | **Encrypted** | No | Plaintext risk | Vendor-locked |
| Docker services | **Yes** | No | No | Yes |
| Mental context | **Yes** | No | No | No |
| Encryption | **Age (full state)** | Server-side | Usually none | Vendor trust |
| Backend required | **No (Git)** | Yes | No | Yes |
| Works offline | **Yes** | Partial | Yes | No |

## Contributing

We welcome contributions! See our [Contributing Guide](https://github.com/Ay7ot/ctx-sync/blob/main/CONTRIBUTING.md) for details on branching strategy, commit conventions, and the development workflow.

## Links

- [Documentation](https://ctx-sync.live/docs/)
- [Security Model](https://ctx-sync.live/docs/security.html)
- [GitHub Repository](https://github.com/Ay7ot/ctx-sync)
- [Changelog](https://github.com/Ay7ot/ctx-sync/blob/main/CHANGELOG.md)

## License

MIT
