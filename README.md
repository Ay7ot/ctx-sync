# ctx-sync

> **Under Construction** — This project is actively being developed.

Sync your complete development context across machines using Git as the backend.

## What is ctx-sync?

**ctx-sync** is a CLI tool that solves the "23-minute context switch" problem by preserving and restoring your entire development state across machines:

- **Project state** — Active repos, branches, uncommitted changes
- **Environment variables** — Encrypted by default with Age encryption
- **Docker services** — Container configurations and auto-start
- **Mental context** — Tasks, blockers, breadcrumbs, next steps
- **Running services** — Dev servers, ports, commands
- **Working directories** — Recent and pinned directories

### Key Features

- **No backend required** — Uses Git for syncing
- **Everything encrypted** — Full state encryption with Age
- **Encrypt-by-default** — All env vars encrypted, eliminating false negatives
- **Zero manual entry** — Import from .env files
- **Zero side-channel leaks** — No secrets in CLI args, shell history, or logs

## Installation

```bash
npm install -g ctx-sync
```

## Quick Start

```bash
# First-time setup
ctx-sync init

# Track a project
cd ~/projects/my-app
ctx-sync track

# Sync to remote
ctx-sync sync

# On another machine
ctx-sync init --restore
ctx-sync restore my-app
```

## Development

```bash
# Clone and setup
git clone <repo-url>
cd ctx-sync
bash tooling/scripts/bootstrap.sh

# Development commands
npm run dev -w apps/cli        # Run CLI in dev mode
npm run test:watch -w apps/cli # Watch tests
npm run build                  # Build all packages
npm run typecheck              # Type-check all packages
npm run lint                   # Run ESLint
npm run test:all               # Run full test suite
```

## Project Structure

```
ctx-sync/
├── apps/
│   ├── cli/           # The ctx-sync CLI tool (TypeScript)
│   └── website/       # Marketing + docs site (vanilla HTML/CSS/JS)
├── packages/
│   └── shared/        # Shared types, constants, utilities
├── tooling/           # CI scripts and dev helpers
└── .github/workflows/ # CI/CD pipelines
```

## License

MIT
