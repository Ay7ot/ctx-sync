# Contributing

ctx-sync is open source and we welcome contributions from the community. This page covers the essentials — for the full guide, see [CONTRIBUTING.md on GitHub](https://github.com/Ay7ot/ctx-sync/blob/main/CONTRIBUTING.md).

## Getting Started

```bash
# Fork and clone
git clone https://github.com/<your-username>/ctx-sync.git
cd ctx-sync

# Install dependencies (includes Husky git hooks)
npm install

# Build shared packages
npm run build -w packages/shared

# Verify everything works
npm run typecheck
npm run lint
npm run test:unit -w apps/cli
```

:::info Prerequisites
Node.js >= 20.0.0 and Git >= 2.25 are required. Run `node --version` to check.
:::

## Branching Strategy

We use a structured branching model. All work happens on feature branches that merge into `develop`, which is then promoted to `main` for releases.

```
feat/<name>  ──squash merge──>  develop  ──merge──>  main  ──tag──>  vX.Y.Z
```

1. Create a feature branch from `develop`: `git checkout -b feat/my-feature develop`
2. Do your work with atomic commits
3. Open a PR targeting `develop` (never directly to `main`)
4. After approval, the PR is squash-merged into `develop`

### Branch Naming

| Prefix | Purpose |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation-only changes |
| `test/` | Test additions or improvements |
| `refactor/` | Code restructuring |
| `chore/` | Maintenance, CI, tooling |

## Commit Convention

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint. Every commit must follow this format:

```
<type>[optional scope]: <description>
```

### Allowed Types

| Type | When to use |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes nor adds |
| `chore` | Maintenance, CI, dependencies |
| `perf` | Performance improvements |

### Examples

```
feat(cli): add --force flag to init command
fix(ci): align release workflow node matrix
docs(website): update FAQ for v1.2.0
test: add coverage for restore --no-pull
```

:::tip Scoped Commits
Use a scope to clarify what area is affected: `cli`, `ci`, `website`, `shared`.
:::

## Pre-commit Hooks

Husky runs these checks on every commit — if any fail, the commit is rejected:

1. **TypeScript typecheck** — `tsc --noEmit` across all packages
2. **ESLint** — linting across all packages
3. **Unit tests** — CLI + shared package tests
4. **Commitlint** — validates your commit message format

## Running Tests

```bash
# Individual suites
npm run test:unit -w apps/cli          # ~800 unit tests
npm run test:integration -w apps/cli   # Integration tests
npm run test:e2e -w apps/cli           # End-to-end tests
npm run test:security -w apps/cli      # ~260 security tests
npm run test:performance -w apps/cli   # Benchmarks

# Everything at once
npm run test:all

# Watch mode (great during development)
npm run test:watch -w apps/cli
```

:::warning Security Tests
If your change touches encryption, key management, file permissions, or Git operations, always run the security suite: `npm run test:security -w apps/cli`
:::

## Security Considerations

ctx-sync handles encryption keys and secrets. When contributing:

- **Never** log, print, or expose private keys or decrypted secrets
- **Never** pass secrets as CLI arguments (use stdin or env vars)
- Ensure file permissions are enforced (key: `0o600`, config dir: `0o700`)
- All new state must be encrypted before writing to disk or Git
- Do not commit `.env` files, credentials, or key material

## CI Pipeline

Every PR triggers these checks — all must pass to merge:

| Check | What it does |
|-------|--------------|
| `lint-and-typecheck` | ESLint + TypeScript across all packages |
| `build` | Compiles shared + CLI packages |
| `test-cli` | Unit, integration, E2E tests (Ubuntu + macOS, Node 20 + 22) |
| `test-shared` | Shared package tests |
| `security` | npm audit + security test suite + secret scanning |

The `main` branch is protected — direct pushes are blocked and all status checks must pass via PR.

## Submitting a Pull Request

1. Ensure your branch is up to date with `develop`
2. Run the checks locally:
   ```bash
   npm run typecheck && npm run lint && npm run test:unit -w apps/cli
   ```
3. Push your branch and open a PR targeting `develop`
4. Fill in the PR with a **Summary** (what and why) and **Test plan** (how you verified)
5. Address review feedback

## Reporting Issues

- Use [GitHub Issues](https://github.com/Ay7ot/ctx-sync/issues)
- Include: OS, Node version, ctx-sync version, steps to reproduce
- For security vulnerabilities, email the maintainer directly — do **not** open a public issue

## Links

- [Full CONTRIBUTING.md](https://github.com/Ay7ot/ctx-sync/blob/main/CONTRIBUTING.md)
- [GitHub Repository](https://github.com/Ay7ot/ctx-sync)
- [Open an Issue](https://github.com/Ay7ot/ctx-sync/issues)
- [npm Package](https://www.npmjs.com/package/ctx-sync)
