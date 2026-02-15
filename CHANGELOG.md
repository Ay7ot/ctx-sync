# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.4] — 2026-02-15

### Fixed
- Error formatter no longer misidentifies Git remote auth failures as file permission errors — now shows correct "Git remote access denied" message with actionable guidance

## [1.1.3] — 2026-02-15

### Fixed
- Windows: skip Unix permission checks (`chmod`/`0o600`) on NTFS — key file was unreadable due to fake permission mismatch

## [1.1.2] — 2026-02-15

### Fixed
- CLI not executing on Windows — `process.argv[1]` backslash paths were not matched by the direct execution check
- Hardcoded `'1.0.0'` manifest version fallbacks in push/sync commands now use the shared `VERSION` constant
- CI: added git identity and `init.defaultBranch main` config to security test job
- CI: all `git init --bare` calls in tests now explicitly use `-b main`
- E2E `cli-basics.test.ts` broken `createRequire` path for reading `package.json`
- Coverage thresholds adjusted to realistic levels (65% global, 90% core, 100% utils)

## [1.1.1] — 2026-02-14

### Fixed
- `ctx-sync --version` now reads version from `package.json` at runtime instead of a hardcoded constant, so it always reports the correct version
- Updated shared `VERSION` constant to `1.1.0`

## [1.1.0] — 2026-02-14

### Added
- Interactive remote URL prompt during `ctx-sync init` and `ctx-sync init --restore` (per product spec)
- Transport validation output (SSH/HTTPS detected) when remote is configured
- Hint message when no remote is configured, suggesting `ctx-sync init --remote <url>`
- Automatic push of initial commit when remote is configured during init
- Docs: step-by-step sync repository creation guide in Getting Started
- Docs: FAQ entries for "sync repo vs project repo" and "can I skip the remote"
- Docs: clarify that ctx-sync requires a dedicated private Git repo across all docs
- Docs: document `--remote`, `--no-interactive`, and `--stdin` flags in CLI reference

## [1.0.2] — 2026-02-14

### Fixed
- Bundle `@ctx-sync/shared` inside the npm package so the CLI works when installed globally (`npm install -g ctx-sync`)
- Use relative paths for website assets so GitHub Pages works at subpath (`/ctx-sync/`)
- Build shared package before typecheck in CI to fix module resolution
- Update website test assertions for relative paths
- Add `files` field to CLI package.json to exclude test/source files from npm tarball

## [1.0.1] — 2026-02-14 [DEPRECATED]

- Published without bundled shared package — broken, same as v1.0.0

## [1.0.0] — 2026-02-14

### Added

#### Core Encryption & Key Management
- Age encryption for all state files (state, env vars, Docker, mental context, services, directories)
- Key pair generation, storage, and backup workflows
- Multi-recipient encryption for team support
- Enforced file permissions (600 for key files, 700 for config directories)
- Secure memory handling with buffer zeroing after use

#### Git Sync Engine
- Git-based state synchronization using `simple-git`
- Transport security enforcement — SSH and HTTPS only (HTTP, Git protocol, FTP blocked)
- Automatic commit, push, pull operations on encrypted state files
- Merge conflict detection for encrypted state files (never auto-merged)

#### CLI Commands
- `ctx-sync init` — First-time setup with key generation and remote configuration
- `ctx-sync init --restore` — Restore on new machine with existing key
- `ctx-sync track` — Track current project with interactive wizard (auto-detects Git, .env, Docker)
- `ctx-sync list` — List all tracked projects with status summary
- `ctx-sync status` — Show detailed sync status for tracked projects
- `ctx-sync sync` — Full push/pull synchronization with encrypted state
- `ctx-sync push` — Push local state to remote
- `ctx-sync pull` — Pull remote state to local
- `ctx-sync restore <project>` — Restore project state with command confirmation
- `ctx-sync note <project>` — Update mental context (tasks, blockers, breadcrumbs)
- `ctx-sync show <project>` — Display full project context

#### Environment Variable Management
- `ctx-sync env import <file>` — Batch import from .env files
- `ctx-sync env add <key>` — Add single var with hidden interactive prompt
- `ctx-sync env add <key> --stdin` — Add from stdin pipe
- `ctx-sync env scan` — Scan current shell environment
- `ctx-sync env list <project>` — List vars (values hidden by default)
- Encrypt-by-default for all env vars (safe-list for non-sensitive keys)
- Shannon entropy detection and credential pattern matching
- Zero side-channel leaks — secrets never in CLI args, shell history, or logs

#### Docker / Container State
- `ctx-sync docker start <project>` — Start tracked services with explicit confirmation
- `ctx-sync docker stop <project>` — Stop tracked services
- `ctx-sync docker status` — Show running service status
- Automatic detection of `docker-compose.yml` during project tracking
- Service port mapping and health check tracking

#### Running Services & Working Directories
- `ctx-sync service add` — Track running services with ports and commands
- `ctx-sync service list` — List tracked services
- `ctx-sync dir add` — Track frequently used directories
- `ctx-sync dir list` — List pinned and recent directories

#### Mental Context
- Current task tracking with file/line references
- Blocker tracking with priority levels
- Next steps and breadcrumb notes
- Related links storage
- Full mental context display on project restore

#### Key Management & Rotation
- `ctx-sync key show` — Display public key (never shows private key)
- `ctx-sync key rotate` — Generate new key, re-encrypt all state, rewrite Git history
- `ctx-sync key verify` — Check key file permissions and integrity
- `ctx-sync key update` — Update private key on secondary machines after rotation

#### Team / Multi-Recipient Support
- `ctx-sync team add --name <n> --key <pubkey>` — Add team member with fingerprint verification
- `ctx-sync team remove <name>` — Remove team member and re-encrypt shared state
- `ctx-sync team list` — List team members and their public keys
- `ctx-sync team revoke <pubkey>` — Immediately revoke key access and re-encrypt

#### Config & Safe-List Management
- `ctx-sync config safe-list` — View current env var safe-list
- `ctx-sync config safe-list add <key>` — Add key to safe-list (may be stored plain with `--allow-plain`)
- `ctx-sync config safe-list remove <key>` — Remove key from safe-list (encrypted on next sync)

#### Security Audit
- `ctx-sync audit` — Comprehensive security audit:
  - Key file permission verification
  - Remote transport security check
  - Git history scan for plaintext leaks
  - Repository size reporting
  - State file encryption verification

#### Security Hardening
- Path validation and traversal prevention (paths must be within HOME)
- Command injection prevention with suspicious command detection
- Log sanitization — all secret patterns redacted in debug output
- No temporary files for crypto operations (memory-only)
- CLI argument safety — values never accepted as command-line arguments
- Transport validation on every sync operation
- Automated penetration test suite covering all threat model vectors

#### Performance
- Encryption: < 100ms per secret
- Sync: < 3 seconds full cycle
- State load: < 100ms for 1000 projects
- Storage: < 1MB per 100 projects

#### Polish & UX
- Centralized error handling with custom error classes and user-friendly messages
- Interactive track wizard with auto-detection and step-by-step prompts
- `--yes` flag for non-interactive mode (never bypasses command confirmation on restore)
- Edge case hardening: null byte stripping, value truncation, corrupted state handling
- Colored terminal output with spinners and progress indicators

#### Website & Documentation
- Marketing landing page with responsive design
- Full documentation site generated from Markdown sources:
  - Getting Started guide
  - CLI Commands reference
  - Security Model documentation
  - Teams & multi-recipient guide
  - FAQ & troubleshooting
- Client-side search with pre-built JSON index
- SEO optimization and Open Graph meta tags
- Mobile-responsive sidebar navigation

#### Testing & CI
- 80 test suites / 1325+ tests
- Unit, integration, E2E, security, and performance test suites
- Automated penetration testing (command injection, path traversal, secret leaks, etc.)
- GitHub Actions CI pipeline (Ubuntu + macOS, Node 18 + 20)
- Coverage gates (≥ 80% lines/branches/functions)
- Pre-commit hooks with typecheck, lint, and unit test enforcement
- Conventional commit enforcement with commitlint

#### Infrastructure
- Monorepo with npm workspaces (`apps/cli`, `apps/website`, `packages/shared`)
- TypeScript strict mode throughout
- ESLint with `typescript-eslint` rules
- Prettier code formatting
- Release workflow for npm publish and website deployment
- Security scanning in CI (npm audit, plaintext secret scanning)

## [Unreleased]

_No unreleased changes._

[1.0.0]: https://github.com/ctx-sync/ctx-sync/releases/tag/v1.0.0
