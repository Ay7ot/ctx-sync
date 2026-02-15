# ctx-sync

> Sync your complete development context across machines using Git as the backend.

**ctx-sync** is a CLI tool that solves the "23-minute context switch" problem by preserving and restoring your entire development state — projects, environment variables, Docker services, mental context, and more — across machines.

## Why ctx-sync?

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

**Requirements:** Node.js >= 18.0.0, Git

## Quick Start

### First-time setup

```bash
# Initialize ctx-sync (generates encryption key, sets up Git repo)
ctx-sync init

# Back up your private key to a password manager!
```

### Track a project

```bash
cd ~/projects/my-app
ctx-sync track

# ctx-sync auto-detects:
#   - Git branch and remote
#   - .env files (prompts to import)
#   - docker-compose.yml (prompts to track services)
#   - Prompts for mental context (what are you working on?)
```

### Sync to remote

```bash
ctx-sync sync
# Encrypts all state → commits to Git → pushes to remote
```

### Restore on another machine

```bash
# One-time setup on the new machine
ctx-sync init --restore
# Paste your private key from your password manager

# Restore a specific project
ctx-sync restore my-app
# Decrypts state → shows context → asks before running any commands
```

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

### Environment Variables
| Command | Description |
|---------|-------------|
| `ctx-sync env import <file>` | Import from .env file (all encrypted) |
| `ctx-sync env add <key>` | Add single var (hidden interactive prompt) |
| `ctx-sync env add <key> --stdin` | Add from stdin pipe |
| `ctx-sync env scan` | Scan current shell environment |
| `ctx-sync env list <project>` | List vars (values hidden by default) |

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
| `ctx-sync docker start <project>` | Start tracked services (with confirmation) |
| `ctx-sync docker stop <project>` | Stop tracked services |
| `ctx-sync docker status` | Show running services |

### Key Management
| Command | Description |
|---------|-------------|
| `ctx-sync key show` | Show public key |
| `ctx-sync key rotate` | Rotate key and re-encrypt all state |
| `ctx-sync key verify` | Verify key file permissions and integrity |
| `ctx-sync key update` | Update key on secondary machines |

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
| `ctx-sync audit` | Run security audit |
| `ctx-sync config safe-list` | View/manage env var safe-list |

## Security Model

ctx-sync takes a **defense-in-depth** approach to security:

### Encrypt Everything by Default
All state files are encrypted with [Age](https://age-encryption.org/) before being written to disk or committed to Git. The only plaintext file is `manifest.json` which contains only version and timestamps — no project names, paths, or sensitive data.

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
- **Transport security** — Git remote must use SSH or HTTPS
- **Command confirmation** — Restored commands always shown before execution
- **File permissions** — Key file: 600, config dir: 700 (enforced at runtime)
- **Key rotation** — Built-in key rotation with Git history rewriting
- **Team revocation** — Remove team member access with automatic re-encryption

For the full security model, see the [Security Documentation](https://ctx-sync.live/docs/security.html).

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

## Development

```bash
# Clone and setup
git clone <repo-url>
cd ctx-sync
npm install

# Development commands
npm run dev -w apps/cli          # Run CLI in dev mode
npm run test:watch -w apps/cli   # Watch tests
npm run build                    # Build all packages
npm run typecheck                # Type-check all packages
npm run lint                     # Run ESLint
npm run test                     # Run unit + shared tests
npm run test:all                 # Run full test suite with coverage

# Test suites
npm run test:unit -w apps/cli        # Unit tests
npm run test:integration -w apps/cli # Integration tests
npm run test:e2e -w apps/cli         # End-to-end tests
npm run test:security -w apps/cli    # Security tests
npm run test:performance -w apps/cli # Performance benchmarks
```

## Project Structure

```
ctx-sync/
├── apps/
│   ├── cli/               # The ctx-sync CLI tool (TypeScript)
│   │   ├── src/
│   │   │   ├── commands/  # CLI command handlers
│   │   │   ├── core/      # Business logic modules
│   │   │   ├── types/     # TypeScript type definitions
│   │   │   └── utils/     # Utilities (errors, etc.)
│   │   └── test/
│   │       ├── unit/          # 45+ unit test files
│   │       ├── integration/   # 9 integration test files
│   │       ├── e2e/           # 17 E2E test files
│   │       ├── security/      # 15 security test files
│   │       └── performance/   # Benchmark tests
│   └── website/           # Marketing + docs site
│       ├── content/       # Markdown documentation sources
│       ├── public/        # Static site (HTML/CSS/JS)
│       └── scripts/       # Build scripts (Markdown → HTML)
├── packages/
│   └── shared/            # Shared types, constants, utilities
├── tooling/               # CI scripts and dev helpers
└── .github/workflows/     # CI/CD pipelines
```

## Test Coverage

- **80 test suites** / **1325+ tests**
- Unit, integration, E2E, security, and performance suites
- Coverage gates: ≥ 80% lines, branches, functions
- Security tests cover all threat model vectors
- Performance benchmarks enforce < 100ms encryption, < 3s sync

## Contributing

1. Fork the repository
2. Create a feature branch from `develop`: `git checkout -b feat/my-feature`
3. Write tests for your changes
4. Ensure all checks pass: `npm run test:all`
5. Submit a PR to `develop`

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
test: add tests
refactor: code restructuring
chore: maintenance tasks
```

## License

MIT

## Links

- [Documentation](https://ctx-sync.live/docs/)
- [Security Model](https://ctx-sync.live/docs/security.html)
- [Changelog](./CHANGELOG.md)
