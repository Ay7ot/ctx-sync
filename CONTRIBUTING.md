# Contributing to ctx-sync

Thanks for your interest in contributing to ctx-sync! This guide covers everything you need to get started.

## Prerequisites

- **Node.js** >= 20.0.0
- **Git** >= 2.25
- **npm** (comes with Node.js)

## Getting Started

```bash
# Fork and clone
git clone https://github.com/Ay7ot/ctx-sync.git
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

## Project Structure

```
ctx-sync/
├── apps/
│   ├── cli/               # The ctx-sync CLI (TypeScript, ESM)
│   │   ├── src/
│   │   │   ├── commands/  # CLI command handlers
│   │   │   ├── core/      # Business logic modules
│   │   │   ├── types/     # TypeScript type definitions
│   │   │   └── utils/     # Utilities (errors, secure memory)
│   │   └── test/
│   │       ├── unit/          # Unit tests (mocked dependencies)
│   │       ├── integration/   # Integration tests (real file I/O)
│   │       ├── e2e/           # End-to-end tests (spawns CLI)
│   │       ├── security/      # Security tests (threat model)
│   │       └── performance/   # Benchmark tests
│   └── website/           # Documentation site
│       ├── content/       # Markdown source files
│       ├── public/        # Generated HTML (do not edit directly)
│       └── scripts/       # Build scripts (Markdown -> HTML)
├── packages/
│   └── shared/            # Shared constants, types, utilities
├── tooling/               # CI scripts and dev helpers
└── .github/workflows/     # CI/CD pipelines
```

## Branching Strategy

We follow a structured branching model:

```
feat/<name>  ──squash merge──>  develop  ──merge──>  main  ──tag──>  vX.Y.Z
                                    ^                   │
                                    └───back-merge──────┘
```

1. **Create a feature branch** from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/my-feature
   ```

2. **Do your work** on the feature branch with atomic commits.

3. **Open a PR** targeting `develop` (never directly to `main`).

4. After approval, the PR is **squash-merged** into `develop`.

5. When ready for release, `develop` is merged into `main`, tagged, and back-merged to `develop`.

### Branch naming

| Prefix     | Purpose                        |
|------------|--------------------------------|
| `feat/`    | New features                   |
| `fix/`     | Bug fixes                      |
| `docs/`    | Documentation-only changes     |
| `test/`    | Test additions or improvements |
| `refactor/`| Code restructuring             |
| `chore/`   | Maintenance, CI, tooling       |

## Commit Convention

This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint. Every commit message must follow this format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to use                          |
|------------|--------------------------------------|
| `feat`     | A new feature                        |
| `fix`      | A bug fix                            |
| `docs`     | Documentation only                   |
| `test`     | Adding or updating tests             |
| `refactor` | Code change that neither fixes nor adds |
| `chore`    | Maintenance, CI, dependencies        |
| `perf`     | Performance improvements             |
| `style`    | Formatting, semicolons, etc.         |

### Scope (optional)

Use a scope to clarify what area is affected:

```
fix(ci): align release workflow node matrix
feat(cli): add --force flag to init command
docs(website): update FAQ for v1.2.0
```

### Rules

- **Subject line**: max 100 characters, imperative mood, no period at end
- **Body lines**: max 100 characters each
- The pre-commit hook runs commitlint automatically — it will reject non-conforming messages

## Pre-commit Hooks

Husky runs the following checks on every commit:

1. **TypeScript typecheck** (`tsc --noEmit`) — all packages
2. **ESLint** — all packages
3. **Unit tests** — CLI + shared
4. **Commitlint** — validates commit message format

If any check fails, the commit is rejected. Fix the issue and try again.

## Running Tests

```bash
# Individual suites
npm run test:unit -w apps/cli          # Unit tests (~800 tests)
npm run test:integration -w apps/cli   # Integration tests
npm run test:e2e -w apps/cli           # End-to-end tests
npm run test:security -w apps/cli      # Security tests (~260 tests)
npm run test:performance -w apps/cli   # Benchmarks

# All tests with coverage
npm run test:all

# Watch mode (useful during development)
npm run test:watch -w apps/cli
```

### Writing Tests

- **Unit tests**: Mock external dependencies (Git, file system). Place in `test/unit/`.
- **Integration tests**: Use real file I/O in temp directories. Place in `test/integration/`.
- **E2E tests**: Spawn the actual CLI binary. Place in `test/e2e/`.
- **Security tests**: Verify the threat model holds. Place in `test/security/`.

All test files use the `.test.ts` extension. The test setup file (`test/setup.ts`) configures temporary directories and Git identity for CI compatibility.

## Code Style

- **TypeScript** with strict mode enabled
- **ESM modules** (`"type": "module"` in package.json)
- **Prettier** for formatting (`npm run format`)
- **ESLint** for linting (`npm run lint` / `npm run lint:fix`)
- No `any` types unless absolutely necessary (and documented)
- Prefer `const` over `let`; avoid `var`

## Security Considerations

ctx-sync handles encryption keys and secrets. When contributing:

- **Never** log, print, or expose private keys or decrypted secrets
- **Never** pass secrets as CLI arguments (use stdin or env vars)
- Ensure file permissions are enforced (key: `0o600`, config dir: `0o700`)
- All new state must be encrypted before writing to disk or Git
- Run `npm run test:security -w apps/cli` to verify your changes don't break the threat model
- Do not commit `.env` files, credentials, or key material

## CI Pipeline

Every PR triggers these checks (all must pass to merge):

| Check | What it does |
|-------|--------------|
| `lint-and-typecheck` | ESLint + TypeScript across all packages |
| `build` | Compiles shared + CLI packages |
| `test-cli` | Unit, integration, E2E tests on Ubuntu + macOS (Node 20 + 22) |
| `test-shared` | Shared package tests |
| `security` | npm audit + security test suite + secret scanning |

The `main` branch is protected — direct pushes are blocked and all status checks must pass via PR.

## Submitting a Pull Request

1. Ensure your branch is up to date with `develop`
2. Run the full check locally:
   ```bash
   npm run typecheck && npm run lint && npm run test:unit -w apps/cli
   ```
3. Push your branch and open a PR targeting `develop`
4. Fill in the PR template with:
   - **Summary** — what changed and why
   - **Test plan** — how you verified it works
5. Address review feedback with fixup commits, then squash on merge

## Reporting Issues

- Use [GitHub Issues](https://github.com/Ay7ot/ctx-sync/issues)
- Include: OS, Node version, ctx-sync version, steps to reproduce
- For security vulnerabilities, email the maintainer directly — do **not** open a public issue

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
