# Context Sync — Master Task Plan

> **Goal:** Take the team from an empty repository to a fully working, production-ready `ctx-sync` CLI tool **and** a marketing + documentation website, delivered incrementally with tests at every step.

---

## Table of Contents

1. [Monorepo Structure Proposal](#1-monorepo-structure-proposal)
2. [Definition of Done (Global)](#2-definition-of-done-global)
3. [Branching Strategy](#3-branching-strategy)
4. [CI Pipeline Steps](#4-ci-pipeline-steps)
5. [Release & Versioning Workflow](#5-release--versioning-workflow)
6. [Phase 0 — Monorepo Scaffolding & Tooling](#phase-0--monorepo-scaffolding--tooling)
7. [Phase 1 — Core Encryption & Key Management ✅](#phase-1--core-encryption--key-management-)
8. [Phase 2 — Git Sync Engine ✅](#phase-2--git-sync-engine-)
9. [Phase 3 — CLI Skeleton & `init` Command ✅](#phase-3--cli-skeleton--init-command-)
10. [Phase 4 — Project State Tracking (`track`, `list`, `status`) ✅](#phase-4--project-state-tracking-track-list-status-)
11. [Phase 5 — Environment Variable Management ✅](#phase-5--environment-variable-management-)
12. [Phase 6 — Sync Commands (`sync`, `push`, `pull`) ✅](#phase-6--sync-commands-sync-push-pull-)
13. [Phase 7 — Restore Command & Command-Execution Safety](#phase-7--restore-command--command-execution-safety)
14. [Phase 8 — Mental Context (`note`, `show`)](#phase-8--mental-context-note-show)
15. [Phase 9 — Docker / Container State](#phase-9--docker--container-state)
16. [Phase 10 — Running Services & Working Directories](#phase-10--running-services--working-directories)
17. [Phase 11 — Key Rotation, Verification & Audit](#phase-11--key-rotation-verification--audit)
18. [Phase 12 — Team / Multi-Recipient Support](#phase-12--team--multi-recipient-support)
19. [Phase 13 — Config & Safe-List Management](#phase-13--config--safe-list-management)
20. [Phase 14 — Security Hardening & Penetration Tests](#phase-14--security-hardening--penetration-tests)
21. [Phase 15 — Performance Benchmarking](#phase-15--performance-benchmarking)
22. [Phase 16 — Polish, UX & Error Handling](#phase-16--polish-ux--error-handling)
23. [Phase 17 — Marketing + Documentation Website](#phase-17--marketing--documentation-website)
24. [Phase 18 — Release Preparation & Launch](#phase-18--release-preparation--launch)

---

## 1. Monorepo Structure Proposal

```
ctx-sync/                         # Root of monorepo
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint → Type-check → Unit → Integration → E2E → Security
│       ├── release.yml           # Publish CLI to npm, deploy website
│       └── security.yml          # Dedicated security & dependency audit
├── .husky/
│   ├── pre-commit                # lint + type-check + unit + security tests
│   └── commit-msg                # Conventional commit enforcement
├── apps/
│   ├── cli/                      # The ctx-sync CLI tool (TypeScript)
│   │   ├── src/
│   │   │   ├── commands/         # CLI command handlers (init, track, sync, …)
│   │   │   ├── core/             # Pure business logic modules
│   │   │   │   ├── encryption.ts
│   │   │   │   ├── env-handler.ts
│   │   │   │   ├── git-sync.ts
│   │   │   │   ├── state-manager.ts
│   │   │   │   ├── transport.ts
│   │   │   │   ├── path-validator.ts
│   │   │   │   ├── command-validator.ts
│   │   │   │   └── log-sanitizer.ts
│   │   │   ├── types/            # TypeScript type definitions
│   │   │   │   ├── state.ts      # State file interfaces (Project, EnvVars, etc.)
│   │   │   │   ├── config.ts     # Config & safe-list types
│   │   │   │   └── index.ts      # Re-exports
│   │   │   ├── utils/
│   │   │   └── index.ts          # CLI entry point (source)
│   │   ├── dist/                 # Compiled JS output (git-ignored)
│   │   ├── test/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   ├── e2e/
│   │   │   │   └── helpers/
│   │   │   ├── security/
│   │   │   ├── performance/
│   │   │   ├── fixtures/
│   │   │   └── helpers/
│   │   ├── package.json
│   │   ├── jest.config.ts        # Jest config (uses ts-jest)
│   │   └── tsconfig.json         # Extends root tsconfig
│   └── website/                  # Marketing + docs (vanilla HTML/CSS/JS — NO TypeScript)
│       ├── public/               # Served as-is
│       │   ├── index.html        # Landing / marketing page
│       │   ├── docs/
│       │   │   ├── index.html    # Docs home
│       │   │   ├── getting-started.html
│       │   │   ├── commands.html
│       │   │   ├── security.html
│       │   │   ├── teams.html
│       │   │   └── faq.html
│       │   ├── css/
│       │   │   ├── main.css
│       │   │   └── docs.css
│       │   ├── js/
│       │   │   ├── main.js       # Marketing interactions (vanilla JS, runs in browser)
│       │   │   ├── docs-nav.js   # Sidebar nav, search
│       │   │   └── docs-search.js
│       │   └── assets/
│       │       ├── images/
│       │       └── favicon.ico
│       ├── content/              # Markdown source for docs (optional build step)
│       │   ├── getting-started.md
│       │   ├── commands.md
│       │   ├── security.md
│       │   ├── teams.md
│       │   └── faq.md
│       ├── scripts/
│       │   └── build-docs.ts     # MD → HTML build (Node script, zero frameworks)
│       ├── package.json
│       ├── tsconfig.json         # Minimal — only for build script
│       └── README.md
├── packages/
│   └── shared/                   # Shared constants, types, utilities (TypeScript)
│       ├── src/
│       │   ├── constants.ts      # Version, safe-list defaults, file names
│       │   ├── schemas.ts        # JSON schemas / Zod validation for state files
│       │   ├── types.ts          # Shared TypeScript interfaces & type exports
│       │   └── errors.ts         # Shared error classes
│       ├── dist/                 # Compiled JS output (git-ignored)
│       ├── package.json
│       ├── jest.config.ts
│       └── tsconfig.json         # Extends root tsconfig
├── tooling/
│   ├── scripts/
│   │   ├── bootstrap.sh          # First-time dev setup
│   │   ├── clean.sh              # Nuke node_modules, coverage, dist, tmp
│   │   └── release.sh            # Tag, changelog, npm publish
│   └── ci/
│       ├── check-secrets.sh      # Scan artifacts for plaintext leaks
│       └── coverage-gate.sh      # Enforce thresholds
├── tsconfig.base.json            # Root TypeScript config (shared compiler options)
├── eslint.config.mjs             # Root ESLint flat config (TypeScript-aware)
├── .prettierrc                   # Root Prettier config
├── .commitlintrc.js              # Conventional Commits enforcement
├── .npmrc
├── package.json                  # Root workspace config (npm workspaces)
├── turbo.json                    # (Optional) Turborepo config for task orchestration
├── CHANGELOG.md
├── LICENSE
└── README.md
```

### Key decisions

| Decision | Rationale |
|----------|-----------|
| **TypeScript everywhere** | All CLI and shared-package source code is TypeScript. Provides compile-time type safety, better IDE support, and self-documenting interfaces. Website browser JS stays vanilla (no build step needed for browser code). |
| **npm workspaces** at the root | Zero extra tooling; native monorepo support. Turborepo optional for caching. |
| `apps/cli` | The core product. Written in TypeScript, compiled to JS for distribution. Published to npm as `ctx-sync`. |
| `apps/website` | Vanilla HTML/CSS/JS only for browser code. Build script (`build-docs.ts`) is TypeScript (runs in Node). No React, no Next, no framework. |
| `packages/shared` | TypeScript types/interfaces, constants (version, default safe-list, file names), Zod schemas for state files, shared error classes. |
| `tooling/` | Shell scripts + CI helpers. Not an npm package. |

---

## 2. Definition of Done (Global)

A task/feature is **done** when ALL of the following are true:

- [ ] Implementation code is written in **TypeScript** (strict mode) and reviewed.
- [ ] All new code has proper type annotations — no `any` except with explicit justification comment.
- [ ] `npm run typecheck` (i.e., `tsc --noEmit`) passes with zero errors across all workspaces.
- [ ] Unit tests are written (in TypeScript) and passing (≥ 80 % line coverage on new code).
- [ ] Integration tests are written and passing (where applicable).
- [ ] E2E tests are written and passing (for user-facing workflows).
- [ ] Security tests cover relevant attack vectors (if security-sensitive).
- [ ] No linter errors (`npm run lint` clean — includes `@typescript-eslint` rules).
- [ ] No `npm audit` warnings at moderate or above on new deps.
- [ ] CI pipeline is green on all matrix entries (ubuntu + macOS, Node 18 + 20).
- [ ] Manual smoke test completed (for UX-facing features).
- [ ] Documentation updated (inline TSDoc/JSDoc + website docs if user-facing).
- [ ] CHANGELOG entry added.
- [ ] PR approved by at least one reviewer (when team > 1).

---

## 3. Branching Strategy

| Branch | Purpose | Merges Into |
|--------|---------|-------------|
| `main` | Production-ready. Every commit is releasable. | — |
| `develop` | Integration branch. Accumulates completed features. | `main` (via release PR) |
| `feat/<name>` | One branch per feature/task. Short-lived. | `develop` |
| `fix/<name>` | Bug fixes. | `develop` or `main` (hotfix) |
| `release/vX.Y.Z` | Release candidate. Freeze features, fix bugs only. | `main` + back-merge to `develop` |
| `hotfix/<name>` | Critical production fix. | `main` + back-merge to `develop` |

**Rules:**
- Squash-merge feature branches into `develop`.
- `develop` → `main` via merge commit (preserves history).
- Tag on `main` after merge: `vX.Y.Z`.
- Protect `main` and `develop` with required status checks (CI green + review).

---

## 4. CI Pipeline Steps

```yaml
# Triggered on push & PR to develop / main
jobs:
  lint-and-typecheck:
    - npm ci (root)
    - npm run lint (root — runs across workspaces, includes @typescript-eslint rules)
    - npm run typecheck (root — runs tsc --noEmit across workspaces)

  build:
    needs: [lint-and-typecheck]
    - npm ci
    - npm run build -w packages/shared    # Compile shared types first
    - npm run build -w apps/cli           # Compile CLI (depends on shared)

  test-cli:
    needs: [build]
    matrix: [ubuntu-latest, macos-latest] × [Node 18.x, 20.x]
    steps:
      - npm ci
      - npm run build -w packages/shared
      - npm run test:unit       -w apps/cli
      - npm run test:integration -w apps/cli
      - npm run test:e2e        -w apps/cli
      - npm run test:coverage   -w apps/cli
      - Upload coverage artifact

  test-shared:
    needs: [lint-and-typecheck]
    - npm ci
    - npm test -w packages/shared

  security:
    needs: [build]
    - npm ci
    - npm audit --audit-level=moderate
    - npm run test:security -w apps/cli
    - npm run test:pentest  -w apps/cli
    - bash tooling/ci/check-secrets.sh   # Scan artifacts for leaks
    - Snyk scan (optional)

  website-build:
    - npm ci -w apps/website
    - npx tsx apps/website/scripts/build-docs.ts
    - Validate HTML (html-validate or similar)
    - Check for broken links

  coverage-gate:
    needs: [test-cli]
    - Download coverage artifact
    - bash tooling/ci/coverage-gate.sh   # Fail if < 80% lines
```

---

## 5. Release & Versioning Workflow

1. **Versioning:** Semantic Versioning (`MAJOR.MINOR.PATCH`).
   - MAJOR: breaking CLI interface changes.
   - MINOR: new commands / features.
   - PATCH: bug fixes, security patches.

2. **Changelog:** Auto-generated from Conventional Commits (`feat:`, `fix:`, `security:`, `docs:`, `perf:`, `chore:`).

3. **Release flow:**
   ```
   develop  →  release/vX.Y.Z (branch)
              ↳ Final testing, bug fixes only
              ↳ Update CHANGELOG.md
              ↳ Bump version in package.json (root + apps/cli)
              ↳ Merge → main
              ↳ Tag vX.Y.Z on main
              ↳ CI publishes to npm: ctx-sync@latest
              ↳ CI deploys website (e.g., GitHub Pages / Netlify / Cloudflare Pages)
              ↳ Back-merge main → develop
   ```

4. **npm publish:**
   ```bash
   # In apps/cli
   npm version <major|minor|patch>
   npm publish --access public
   ```

5. **Website deploy:** Static files from `apps/website/public/` pushed to hosting on every `main` merge.

---

## Phase 0 — Monorepo Scaffolding & Tooling ✅

> **Goal:** Empty repo → buildable, testable, lintable monorepo with CI and a working test harness. No product code yet.
>
> **Status:** Complete. All 8 tasks done. Monorepo is buildable, testable, lintable, type-checked, and CI-ready.

### Task 0.1 — Initialize repository & npm workspaces ✅

**Implementation tasks:**
- [x] `git init` + initial commit.
- [x] Create root `package.json` with `"workspaces": ["apps/*", "packages/*"]`.
- [x] Create `apps/cli/package.json` with name `ctx-sync`, `bin` entry pointing to `dist/index.js`, and minimum fields.
- [x] Create `apps/website/package.json` with name `@ctx-sync/website` (private).
- [x] Create `packages/shared/package.json` with name `@ctx-sync/shared`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`.
- [x] Create placeholder `src/index.ts` in `apps/cli` and `packages/shared` so the project compiles.
- [x] Add root `.gitignore` (node_modules, coverage, dist, .env*, *.age, tmp).
- [x] Add root `.npmrc` (`save-exact=true`).
- [x] Run `npm install` from root — verify workspaces resolve.

**Test plan:**
- Unit: N/A (no code yet).
- Integration: Run `npm install` from root — exits 0.
- E2E: N/A.

**Acceptance criteria:**
- `npm install` at root installs all workspace dependencies.
- `npx tsx apps/cli/src/index.ts` prints a placeholder message (or `npm run build && node apps/cli/dist/index.js`).
- `packages/shared` is resolvable from `apps/cli` via `import { … } from '@ctx-sync/shared'` (TypeScript path resolution works).

**Done when:**
- [x] All checks above pass.
- [x] Committed to `develop`.

---

### Task 0.2 — TypeScript configuration ✅

**Implementation tasks:**
- [x] Install at root devDeps: `typescript` (latest stable 5.x).
- [x] Install at root devDeps: `@types/node` (matching minimum supported Node version).
- [x] Install `tsx` at root devDeps (for running `.ts` scripts directly during development).
- [x] Create root `tsconfig.base.json` with shared compiler options:
  ```jsonc
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "Node16",
      "moduleResolution": "Node16",
      "strict": true,                    // Full strict mode
      "noUncheckedIndexedAccess": true,  // Catch undefined array/object access
      "noImplicitOverride": true,
      "forceConsistentCasingInFileNames": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "outDir": "dist",
      "rootDir": "src"
    }
  }
  ```
- [x] Create `apps/cli/tsconfig.json` extending root:
  ```jsonc
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
      "outDir": "dist",
      "rootDir": "src"
    },
    "include": ["src/**/*.ts"],
    "exclude": ["node_modules", "dist", "test"]
  }
  ```
- [x] Create `packages/shared/tsconfig.json` extending root (same pattern).
- [x] Create `apps/website/tsconfig.json` (minimal — only covers `scripts/build-docs.ts`).
- [x] Add scripts to root `package.json`:
  ```json
  "typecheck": "tsc --noEmit -p apps/cli/tsconfig.json && tsc --noEmit -p packages/shared/tsconfig.json",
  "build": "npm run build -w packages/shared && npm run build -w apps/cli"
  ```
- [x] Add scripts to `apps/cli/package.json`:
  ```json
  "build": "tsc",
  "typecheck": "tsc --noEmit",
  "dev": "tsx src/index.ts"
  ```
- [x] Add scripts to `packages/shared/package.json`:
  ```json
  "build": "tsc",
  "typecheck": "tsc --noEmit"
  ```
- [x] Verify `npm run typecheck` at root exits 0 on placeholder files.
- [x] Verify `npm run build` at root compiles to `dist/` in each package.

**Test plan:**
- Unit: N/A.
- Integration: `npm run typecheck` exits 0. `npm run build` produces `dist/` directories. Compiled output is runnable with `node`.

**Acceptance criteria:**
- `npm run typecheck` exits 0 (strict mode, no errors).
- `npm run build -w apps/cli` produces `apps/cli/dist/index.js`.
- `npm run build -w packages/shared` produces `packages/shared/dist/index.js` + `.d.ts` declarations.
- `dist/` directories are git-ignored.

**Done when:**
- [x] TypeScript compiles cleanly.
- [x] Committed.

---

### Task 0.3 — ESLint + Prettier (TypeScript-aware) ✅

**Implementation tasks:**
- [x] Install at root devDeps: `eslint` (v9+ flat config), `@eslint/js`, `typescript-eslint`, `prettier`, `eslint-config-prettier`, `eslint-plugin-import`.
- [x] Create root `eslint.config.mjs` (ESLint flat config format):
  - Extends `typescript-eslint` recommended + strict configs.
  - Uses `typescript-eslint` parser for all `.ts` files.
  - Rules: `@typescript-eslint/no-explicit-any: warn`, `@typescript-eslint/no-unused-vars: error`, `@typescript-eslint/explicit-function-return-type: warn` (for exported functions), import ordering.
  - Ignores: `node_modules`, `coverage`, `dist`, `apps/website/public/**/*.js`.
- [x] Create root `.prettierrc` — single quotes, trailing commas, 2-space indent, print width 100.
- [x] Add root scripts: `"lint": "eslint apps packages"`, `"lint:fix": "eslint apps packages --fix"`, `"format": "prettier --write ."`.

**Test plan:**
- Unit: N/A.
- Integration: `npm run lint` exits 0 on placeholder `.ts` files. Intentionally bad TypeScript triggers lint errors (e.g., `any` usage, unused vars, missing return types).

**Acceptance criteria:**
- `npm run lint` exits 0.
- TypeScript-specific rules enforced (no implicit `any`, no unused vars, return type annotations on exports).
- Prettier formatting consistent.

**Done when:**
- [x] Lint is green.
- [x] Committed.

---

### Task 0.4 — Jest test harness for CLI (TypeScript with ts-jest) ✅

**Implementation tasks:**
- [x] Install in `apps/cli` devDeps: `jest`, `ts-jest`, `@types/jest`, `mock-fs`, `@types/mock-fs`, `tmp`, `nock`, `@faker-js/faker`.
- [x] Create `apps/cli/jest.config.ts`:
  ```ts
  import type { Config } from 'jest';

  const config: Config = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/test'],
    transform: {
      '^.+\\.ts$': 'ts-jest',
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    coverageDirectory: 'coverage',
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
    coverageThreshold: {
      global: { branches: 80, functions: 80, lines: 80, statements: 80 },
    },
    testMatch: ['**/test/**/*.test.ts'],
    setupFilesAfterSetup: ['<rootDir>/test/setup.ts'],
    testTimeout: 10000,
  };

  export default config;
  ```
- [x] Create `apps/cli/test/tsconfig.json` — extends CLI tsconfig but includes `test/` and allows `jest` globals:
  ```jsonc
  {
    "extends": "../tsconfig.json",
    "compilerOptions": {
      "rootDir": "..",
      "noEmit": true,
      "types": ["jest", "node"]
    },
    "include": ["**/*.ts", "../src/**/*.ts"]
  }
  ```
- [x] Create `apps/cli/test/setup.ts` — global TEST_DIR in os.tmpdir, beforeAll/afterAll/afterEach cleanup (typed).
- [x] Create directory stubs: `test/{unit,integration,e2e,security,performance,fixtures,helpers}`.
- [x] Add scripts to `apps/cli/package.json`:
  ```json
  "test": "jest",
  "test:unit": "jest test/unit",
  "test:integration": "jest test/integration",
  "test:e2e": "jest test/e2e",
  "test:security": "jest test/security",
  "test:pentest": "jest test/security/pentest.test.ts",
  "test:coverage": "jest --coverage",
  "test:watch": "jest --watch",
  "test:performance": "npx tsx test/performance/benchmarks.ts",
  "test:all": "npm run typecheck && npm run lint && jest --coverage"
  ```
- [x] Create a trivial `test/unit/placeholder.test.ts` that passes.
- [x] Verify `npm test -w apps/cli` exits 0.

**Test plan:**
- Unit: Placeholder test passes (written in TypeScript).
- Integration: Coverage report generates for `.ts` source files.

**Acceptance criteria:**
- `npm test -w apps/cli` green.
- `npm run test:coverage -w apps/cli` produces `coverage/` directory with `.ts` file coverage.
- Tests can import from `src/` with full type checking.

**Done when:**
- [x] Test harness works from root and from apps/cli.
- [x] Committed.

---

### Task 0.5 — Jest test harness for shared package (TypeScript) ✅

**Implementation tasks:**
- [x] Install `jest`, `ts-jest`, `@types/jest` in `packages/shared` devDeps.
- [x] Create `packages/shared/jest.config.ts` (simpler — `preset: 'ts-jest'`, no setup file needed).
- [x] Create `packages/shared/test/placeholder.test.ts`.
- [x] Add `"test": "jest"` script.

**Test plan:**
- Unit: Placeholder test passes (TypeScript).

**Acceptance criteria:**
- `npm test -w packages/shared` green.

**Done when:**
- [x] Committed.

---

### Task 0.6 — Husky pre-commit hooks + commitlint ✅

**Implementation tasks:**
- [x] Install `husky`, `@commitlint/cli`, `@commitlint/config-conventional` at root.
- [x] `npx husky init` — create `.husky/` dir.
- [x] Create `.husky/pre-commit`: runs `npm run typecheck && npm run lint && npm run test:unit -w apps/cli && npm run test -w packages/shared`.
- [x] Create `.husky/commit-msg`: runs `npx commitlint --edit $1`.
- [x] Create `.commitlintrc.js` — extends `@commitlint/config-conventional`.
- [x] Add `"prepare": "husky"` to root `package.json`.

**Test plan:**
- Integration: Attempt a commit with bad message → rejected. Attempt a commit with lint error → rejected. Good commit → succeeds.

**Acceptance criteria:**
- Non-conventional commit messages are rejected.
- Commits with lint errors are rejected.
- Clean commits go through.

**Done when:**
- [x] Hooks functional.
- [x] Committed.

---

### Task 0.7 — GitHub Actions CI pipeline ✅

**Implementation tasks:**
- [x] Create `.github/workflows/ci.yml` implementing the pipeline from Section 4.
- [x] Create `.github/workflows/security.yml` — runs security job only.
- [x] Create `tooling/ci/check-secrets.sh` — grep for known token patterns in test output dirs; exit 1 if found.
- [x] Create `tooling/ci/coverage-gate.sh` — parse coverage-summary.json, fail if lines < 80 %.
- [x] Create `tooling/scripts/bootstrap.sh` — `npm install` + `npx husky`.
- [x] Create `tooling/scripts/clean.sh` — removes `node_modules`, `coverage`, `/tmp/ctx-sync-test*`.

**Test plan:**
- Integration: Push to a branch → CI runs → green on placeholder tests.

**Acceptance criteria:**
- CI matrix (ubuntu × macOS, Node 18 × 20) all green.
- Security job green.
- Coverage gate passes (placeholder achieves 100 %).

**Done when:**
- [x] CI pipeline green on first push.
- [x] Committed.

---

### Task 0.8 — Release skeleton ✅

**Implementation tasks:**
- [x] Create `.github/workflows/release.yml` — triggered on tag `v*`. Steps: npm ci → test:all → npm publish (dry-run for now) → deploy website (placeholder).
- [x] Create `tooling/scripts/release.sh` — bumps version, generates CHANGELOG entry (manual template for now), creates git tag.
- [x] Create root `CHANGELOG.md` with `## [Unreleased]` section.
- [x] Create root `LICENSE` (MIT).
- [x] Create root `README.md` with project overview and "under construction" note.

**Test plan:**
- Integration: Run `tooling/scripts/release.sh` in dry-run mode — verify version bump.

**Acceptance criteria:**
- Release workflow is syntactically valid (GitHub validates on push).
- `CHANGELOG.md` exists with correct structure.

**Done when:**
- [x] Committed.
- [x] Phase 0 complete. The monorepo is buildable, testable, lintable, type-checked, and CI-ready.

---

## Phase 1 — Core Encryption & Key Management ✅

> **Goal:** Build the encryption module — the security foundation everything depends on.
>
> **Status:** Complete. All 3 tasks done. Age encryption wrapper, key persistence with permission enforcement, and secure memory handling implemented with 74 tests (57 unit + 17 security) at 100% coverage. Project migrated to ESM.

### Task 1.1 — Age encryption wrapper module ✅

**Implementation tasks:**
- [x] Install `age-encryption` in `apps/cli`.
- [x] Create `apps/cli/src/core/encryption.ts` with full type annotations, exporting:
  - `generateKey(): Promise<{ publicKey: string; privateKey: string }>`
  - `encrypt(plaintext: string, publicKey: string): Promise<string>` → Age ciphertext
  - `decrypt(ciphertext: string, privateKey: string): Promise<string>` → plaintext
  - `encryptState<T>(data: T, publicKey: string): Promise<string>` → Age ciphertext (serialises JSON, encrypts entire blob)
  - `decryptState<T>(ciphertext: string, privateKey: string): Promise<T>` → parsed typed object
- [x] Define interfaces in `src/types/state.ts` for all state file structures (imported by encryption module).
- [x] All operations are in-memory only — no temp files.

**Test plan:**

- *Unit tests* (`test/unit/encryption.test.ts`):
  - `generateKey()` produces valid Age key pair (public key matches `age1…` pattern, private key contains `AGE-SECRET-KEY-`).
  - Keys are unique per call.
  - `encrypt()` produces ciphertext containing `-----BEGIN AGE ENCRYPTED FILE-----`.
  - Ciphertext does NOT contain the plaintext.
  - Same plaintext → different ciphertext (non-deterministic).
  - Empty string encrypts/decrypts correctly.
  - Special characters (emoji, unicode) round-trip.
  - Multi-line values round-trip.
  - Invalid public key → throws.
  - `decrypt()` with wrong private key → throws.
  - `encryptState()` encrypts a JSON object; result doesn't contain any key or value.
  - `decryptState()` round-trips correctly.

- *Security tests* (`test/security/state-encryption.test.ts`):
  - After `encryptState`, no JSON structure visible in output.
  - After writing `.age` file to disk, reading it back yields only ciphertext.

**Acceptance criteria:**
- All unit tests pass.
- 100 % line coverage on `encryption.ts`.
- No plaintext leaks in any `.age` output.

**Done when:**
- [x] All tests passing in CI.
- [x] Coverage ≥ 80 % on this module.

---

### Task 1.2 — Key persistence (save / load with permission enforcement) ✅

**Implementation tasks:**
- [x] Add to `encryption.ts` (or new `key-store.ts`):
  - `saveKey(configDir, privateKey)` — creates dir at 0o700, writes `key.txt` at 0o600.
  - `loadKey(configDir)` — reads `key.txt`, verifies permissions are exactly 0o600 before returning. Throws on insecure permissions.
- [x] Expose public key extraction from private key if needed, or store both.

**Test plan:**

- *Unit tests* (`test/unit/key-store.test.ts`):
  - `saveKey` creates directory with 0o700.
  - `saveKey` writes file with 0o600.
  - `loadKey` returns correct key.
  - `loadKey` throws if file permissions are not 0o600 (e.g., 0o644).
  - `loadKey` throws if file does not exist.

- *Security tests* (`test/security/file-permissions.test.ts`):
  - Key file permissions are 0o600 after save.
  - Config dir permissions are 0o700 after save.
  - Loading key with 0o644 → error with message "insecure permissions".

**Acceptance criteria:**
- Permission enforcement is strict.
- Error messages guide the user to fix (`chmod 600 <path>`).

**Done when:**
- [x] All tests passing in CI.

---

### Task 1.3 — Secure memory handling ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/utils/secure-memory.ts`:
  - `withSecret(buffer, fn)` — calls `fn(buffer)`, then zeroes the buffer in `finally`.
  - `clearString(variable)` — best-effort clearing (note JS string immutability limitations, document trade-off).
- [x] Document limitations in code comments.

**Test plan:**

- *Unit tests* (`test/unit/secure-memory.test.ts`):
  - After `withSecret`, buffer is all zeroes.
  - `fn` receives the original buffer content.
  - If `fn` throws, buffer is still zeroed.

- *Security tests* (`test/security/memory-safety.test.ts`):
  - Buffer zeroing verified.

**Acceptance criteria:**
- Buffers are zeroed after use.

**Done when:**
- [x] All tests passing in CI.

---

## Phase 2 — Git Sync Engine ✅

> **Goal:** Build the module that initialises, commits, pushes, and pulls the `~/.context-sync/` Git repo.

### Task 2.1 — Git repository management ✅

**Implementation tasks:**
- [x] Install `simple-git` in `apps/cli`.
- [x] Create `apps/cli/src/core/git-sync.ts` exporting:
  - `initRepo(dir)` — `git init` if no `.git/` exists; no-op if already initialised.
  - `addRemote(dir, url)` — add origin; validate URL first (defer to transport module).
  - `commitState(dir, files, message)` — `git add <files> && git commit -m <message>`; skip if no changes.
  - `pushState(dir)` — `git push origin main`.
  - `pullState(dir)` — `git pull origin main`.
  - `getStatus(dir)` — returns `{ files, ahead, behind }`.

**Test plan:**

- *Unit tests* (`test/unit/git-sync.test.ts`) — mock `simple-git`:
  - `initRepo` calls `git.init()` on new dir.
  - `initRepo` skips init on existing `.git/`.
  - `commitState` adds files and commits.
  - `commitState` skips commit if no changes.
  - `pushState` calls `git.push`.
  - `pullState` calls `git.pull`.

- *Integration tests* (`test/integration/git-operations.test.ts`) — real git in temp dir:
  - Init repo, commit a file, verify `git log` shows commit.
  - Push/pull between two local repos via a bare remote.

**Acceptance criteria:**
- All git operations work with real git in temp directories.
- Mocked unit tests cover edge cases.

**Done when:**
- [x] All tests passing in CI.

---

### Task 2.2 — Transport security validation ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/core/transport.ts`:
  - `validateRemoteUrl(url)` — accepts SSH (`git@…`) and HTTPS (`https://…`); rejects `http://`, `git://`, `ftp://`. Throws with clear error message. Also allows local paths (`/path/to/repo.git`, `file://`) since they have no network transit.
- [x] Called by `git-sync.ts` on `addRemote`, `pushState`, `pullState`.

**Test plan:**

- *Unit tests* (`test/unit/transport.test.ts`):
  - SSH URLs accepted.
  - HTTPS URLs accepted.
  - HTTP URLs rejected with "Insecure Git remote" error.
  - `git://` URLs rejected.
  - `ftp://` URLs rejected.
  - Edge: empty string, null, malformed URLs all handled gracefully.

- *Security tests* (`test/security/transport.test.ts`):
  - Validate called on every sync operation (spy).
  - All insecure protocols rejected.

**Acceptance criteria:**
- No sync operation can proceed over insecure transport.

**Done when:**
- [x] All tests passing in CI.

---

## Phase 3 — CLI Skeleton & `init` Command ✅

> **Goal:** Wire up Commander.js, implement the `init` and `init --restore` flows.
>
> **Status:** Complete. All 3 tasks done. Commander.js CLI framework wired with --version/--help, `ctx-sync init` for fresh setup (key gen, permissions, Git repo, manifest), and `ctx-sync init --restore` for new-machine onboarding (key restore via stdin/prompt, remote validation, repo clone). 204 tests passing (119 unit + 21 integration + 46 security + 18 E2E).

### Task 3.1 — CLI entry point & commander setup ✅

**Implementation tasks:**
- [x] Install `commander`, `chalk`, `ora`, `enquirer` in `apps/cli`.
- [x] Create `apps/cli/src/index.ts`:
  - Parse CLI with Commander.
  - Register `--version`, `--help`.
  - Register subcommands (stubs for now).
- [x] Set `"bin": { "ctx-sync": "dist/index.js" }` in `package.json` (points to compiled output).
- [x] Add shebang `#!/usr/bin/env node` to compiled output (configure in tsconfig or build script).
- [x] Verify `npx tsx apps/cli/src/index.ts --version` prints version (dev mode).
- [x] Verify `npm run build -w apps/cli && node apps/cli/dist/index.js --version` prints version (production mode).

**Test plan:**

- *E2E tests* (`test/e2e/cli-basics.test.ts`):
  - `ctx-sync --version` prints version string.
  - `ctx-sync --help` prints help text listing commands.
  - Unknown command → non-zero exit + error message.

**Acceptance criteria:**
- CLI is invocable as `ctx-sync` (after `npm link` or direct `node`).
- Version matches `package.json`.

**Done when:**
- [x] All tests passing in CI.

---

### Task 3.2 — `ctx-sync init` command ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/init.ts`:
  - Generate Age key pair.
  - Save private key to `~/.config/ctx-sync/key.txt` (0o600).
  - Display public key.
  - Prompt for backup method (1Password/Bitwarden text, clipboard with 30s clear, skip with `--skip-backup`).
  - Prompt for Git remote URL.
  - Validate remote URL (transport security).
  - Initialize `~/.context-sync/` Git repo.
  - Add remote.
  - Create `manifest.json` with version + timestamp.
  - Commit and push.
  - Support `--no-interactive` flag for CI/testing (auto-skip prompts, use defaults).

**Test plan:**

- *Unit tests* (`test/unit/init.test.ts`) — mock prompts & git:
  - Key generation is called.
  - Key is saved with correct permissions.
  - Remote URL is validated.
  - manifest.json is created with correct fields.
  - `--no-interactive` skips prompts.

- *Integration tests* (`test/integration/init-workflow.test.ts`):
  - Full init creates correct directory structure.
  - Key file has 0o600 permissions.
  - Config dir has 0o700 permissions.
  - Git repo is initialized with correct remote.

- *E2E tests* (`test/e2e/init.test.ts`):
  - `ctx-sync init --no-interactive` completes successfully.
  - Output contains "Generating encryption key".
  - Output contains "Permissions: 600".
  - Directory structure is correct on disk.

- *Security tests* (`test/security/init-security.test.ts`):
  - Key never appears in stdout (only public key shown, not private).
  - No plaintext key in any log output.

**Acceptance criteria:**
- Fresh `ctx-sync init` creates a working, encrypted-ready state.
- `ctx-sync init --restore` (Task 3.3) can use the key.
- Insecure remote URLs are blocked.

**Done when:**
- [x] All tests passing in CI.

---

### Task 3.3 — `ctx-sync init --restore` command ✅

**Implementation tasks:**
- [x] Extend `init.ts` to handle `--restore` flag:
  - Prompt user to paste private key (hidden input, or `--stdin`).
  - Save key with 0o600 permissions.
  - Prompt for Git remote URL.
  - Validate remote URL.
  - Clone the sync repo to `~/.context-sync/`.
  - Decrypt manifest, list found projects.
  - Print summary.

**Test plan:**

- *Unit tests*:
  - Restore flow prompts for key.
  - Key is saved correctly.
  - Remote URL is validated.

- *Integration tests* (`test/integration/init-workflow.test.ts`):
  - Init on machine A → restore on machine B (same key) → correct structure.

- *E2E tests* (`test/e2e/init.test.ts`):
  - Full init → restore on "different machine" (different temp dir).
  - Restore with wrong key → error.

**Acceptance criteria:**
- A user can set up a new machine in < 30 seconds with `init --restore`.
- Wrong key → clear error, no crash.

**Done when:**
- [x] All tests passing in CI.

---

## Phase 4 — Project State Tracking (`track`, `list`, `status`) ✅

> **Goal:** Users can track projects, and the state is encrypted and stored.

### Task 4.1 — State manager module

**Implementation tasks:**
- [x] Create `apps/cli/src/core/state-manager.ts`:
  - `readState(stateDir, privateKey)` — reads `state.age`, decrypts, returns JSON.
  - `writeState(stateDir, data, publicKey)` — encrypts JSON, writes `state.age`. NEVER writes `.json`.
  - Same pattern for each state file type: `env-vars.age`, `docker-state.age`, `mental-context.age`, `services.age`, `directories.age`.
  - `readManifest(stateDir)` / `writeManifest(stateDir, data)` — plaintext JSON, no secrets.
- [x] Add to `packages/shared/src/schemas.ts`: JSON schema definitions for each state file structure.

**Test plan:**

- *Unit tests* (`test/unit/state-manager.test.ts`):
  - `writeState` produces `.age` file, not `.json`.
  - `readState` decrypts and parses correctly.
  - Round-trip for each state file type.
  - Attempt to write plaintext `.json` → error.
  - `readManifest` / `writeManifest` work for plaintext manifest.

- *Security tests* (`test/security/state-encryption.test.ts`):
  - After writeState, no plaintext JSON exists on disk.
  - `.age` file contents don't contain any state keys/values.
  - Only `manifest.json` is plaintext; it contains only version + timestamps.

**Acceptance criteria:**
- State is always encrypted on disk.
- No plaintext state ever written.

**Done when:**
- [x] All tests passing in CI.

---

### Task 4.2 — Path validation module

**Implementation tasks:**
- [x] Create `apps/cli/src/core/path-validator.ts`:
  - `validateProjectPath(p)` — resolves path, ensures within `$HOME` or explicitly approved dirs. Rejects `/etc/`, `/usr/`, symlinks to outside dirs, `..` traversal.
  - `canonicalize(p)` — resolve `~`, env vars, normalize.

**Test plan:**

- *Unit tests* (`test/unit/path-validator.test.ts`):
  - Valid paths within HOME accepted.
  - `/etc/passwd` rejected.
  - `../../etc/shadow` rejected.
  - Symlinks pointing outside HOME rejected.
  - `~/projects/my-app` accepted.

- *Security tests* (`test/security/path-traversal.test.ts`):
  - Full suite of traversal attempts from testing.md spec.

**Acceptance criteria:**
- No path outside HOME is ever accepted.

**Done when:**
- [x] All tests passing in CI.

---

### Task 4.3 — `ctx-sync track` command

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/track.ts`:
  - Detect current directory's Git repo (branch, remote, stash count, uncommitted changes).
  - Validate path.
  - Prompt: found `.env`? Import? (defer to Phase 5 if not ready — just save project state).
  - Prompt: found `docker-compose.yml`? Track services? (defer to Phase 9).
  - Prompt: what are you working on? (mental context — defer to Phase 8).
  - Encrypt project state → write `state.age`.
  - Update `manifest.json`.
  - Optionally sync to Git.

**Test plan:**

- *Unit tests* (`test/unit/track.test.ts`) — mock git, fs:
  - Detects git branch correctly.
  - Detects `.env` file presence.
  - Creates correct state structure.
  - Path validation is called.

- *Integration tests* (`test/integration/track-workflow.test.ts`):
  - Create temp git repo → `track` → verify `state.age` exists and is encrypted.
  - Verify `state.age` does not contain project name or path in plaintext.
  - Verify no `state.json` exists.

- *E2E tests* (`test/e2e/track.test.ts`):
  - Full `init` → `track` in a test project → verify output messages.
  - Track project without git → handles gracefully.
  - Track project without `.env` → handles gracefully.

**Acceptance criteria:**
- `ctx-sync track` auto-detects and records project state.
- State is encrypted on disk.
- Path validation prevents tracking dangerous paths.

**Done when:**
- [x] All tests passing in CI.

---

### Task 4.4 — `ctx-sync list` command

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/list.ts`:
  - Read `state.age`, decrypt, list all tracked projects.
  - Display: name, path, branch, last accessed.

**Test plan:**

- *Unit tests*:
  - Formats output correctly.
  - Handles empty state (no projects).

- *E2E tests*:
  - `init` → `track` → `list` → output contains project name.
  - `init` → `list` (no projects) → "No projects tracked."

**Acceptance criteria:**
- List shows all tracked projects with key metadata.

**Done when:**
- [x] All tests passing in CI.

---

### Task 4.5 — `ctx-sync status` command

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/status.ts`:
  - Show sync status: last sync time, pending changes, remote connectivity.
  - Show per-project status: branch, uncommitted changes.

**Test plan:**

- *Unit tests*:
  - Correct status formatting.
  - Handles offline (no remote).

- *E2E tests*:
  - `init` → `track` → `status` → output contains sync info.

**Acceptance criteria:**
- Users can quickly see if their state is current.

**Done when:**
- [x] All tests passing in CI.

---

## Phase 5 — Environment Variable Management ✅

> **Goal:** Full env var lifecycle: import, add, scan, list — with encrypt-by-default.
>
> **Status:** Complete. All 5 tasks done. Env handler core module, env command group (import, add, scan, list), encrypt-by-default, CLI arg security, comprehensive tests.

### Task 5.1 — Env handler module (encrypt-by-default + safe-list) ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/core/env-handler.ts`:
  - `shouldEncrypt(key, value)` — encrypt by default; safe-listed keys may be plain only if `--allow-plain`.
  - `hasHighEntropy(value)` — Shannon entropy check (threshold > 4.0, min length 16).
  - `containsCredentialPattern(value)` — regex patterns for Stripe, GitHub, Slack, Google, AWS, JWT, PEM, URL credentials, SendGrid, Twilio, OpenAI.
  - `parseEnvFile(content)` — parse `.env` format (handles comments, empty lines, quotes, multi-line, `export` prefix).
  - `importEnvVars(project, vars, publicKey)` — encrypt all, write `env-vars.age`.
  - `addEnvVar(project, key, value, publicKey)` — add single var to existing encrypted state.
  - `listEnvVars(project, privateKey, showValues)` — decrypt and list (values hidden by default).
- [x] Add default safe-list to `packages/shared/src/constants.ts`:
  ```ts
  export const DEFAULT_SAFE_LIST: readonly string[] = [
    'NODE_ENV', 'PORT', 'HOST', 'DEBUG',
    'LOG_LEVEL', 'TZ', 'LANG', 'SHELL',
    'EDITOR', 'TERM', 'COLORTERM', 'CI', 'VERBOSE',
  ] as const;
  ```

**Test plan:**

- *Unit tests* (`test/unit/env-handler.test.ts`) — **extensive**, per testing.md:
  - `shouldEncrypt` encrypts ALL values by default.
  - `shouldEncrypt` allows safe-listed keys to be plain.
  - `shouldEncrypt` encrypts safe-listed keys if value looks sensitive.
  - `hasHighEntropy` detects high-entropy strings (API keys).
  - `hasHighEntropy` does not flag low-entropy strings.
  - `hasHighEntropy` ignores short strings.
  - `containsCredentialPattern` detects: Stripe, GitHub PAT, GitHub OAuth, fine-grained PAT, Slack bot, Slack user, Google API, AWS access key, SendGrid, OpenAI.
  - `containsCredentialPattern` detects JWTs.
  - `containsCredentialPattern` detects PEM private keys.
  - `containsCredentialPattern` detects URLs with embedded credentials.
  - `containsCredentialPattern` does NOT flag safe values.
  - `parseEnvFile` handles: standard `KEY=value`, comments, empty lines, quoted values, multi-line, `export` prefix, Windows line endings, no value, no equals, duplicate keys.

- *Security tests* (`test/security/secret-leak.test.ts`):
  - After import, `env-vars.age` on disk contains NO plaintext values, key names, or JSON structure.
  - No temp files created during encryption.
  - Log sanitization redacts secrets.

**Acceptance criteria:**
- All env vars encrypted by default.
- Safe-list only used with explicit `--allow-plain`.
- Credential pattern detection catches all patterns from product spec.

**Done when:**
- [x] All tests passing in CI.
- [x] 100 % coverage on `shouldEncrypt`, `hasHighEntropy`, `containsCredentialPattern`.

---

### Task 5.2 — `ctx-sync env import` command ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/env.ts` (or `env-import.ts`):
  - `ctx-sync env import <project> <file>` — reads `.env`, calls `parseEnvFile`, `importEnvVars`.
  - `ctx-sync env import <project> --stdin` — reads from stdin pipe.
  - Shows count of vars imported, encryption status.
  - `--allow-plain` flag: safe-listed keys stored in plaintext section (still encrypted at file level since entire `.age` blob).
- [x] Secret values NEVER appear in CLI output (show key names only).

**Test plan:**

- *Unit tests*:
  - Parses file correctly, calls importEnvVars.
  - `--stdin` reads from process.stdin.
  - Output shows count but not values.

- *Integration tests*:
  - Create `.env` file → import → verify `env-vars.age` is encrypted.
  - Verify original `.env` is NOT modified or deleted.

- *E2E tests*:
  - `init` → create `.env` → `env import` → verify encrypted file on disk.
  - Pipe: `cat .env | ctx-sync env import project --stdin` works.

**Acceptance criteria:**
- Batch import from `.env` file works.
- All values encrypted on disk.
- No values in CLI output or logs.

**Done when:**
- [x] All tests passing in CI.

---

### Task 5.3 — `ctx-sync env add` command (secure input) ✅

**Implementation tasks:**
- [x] Add to env command:
  - `ctx-sync env add <project> <key>` — prompts for value with hidden input (enquirer password type).
  - `ctx-sync env add <project> <key> --stdin` — reads value from stdin.
  - `ctx-sync env add <project> <key> --from-fd N` — reads from file descriptor.
  - **REJECT** `ctx-sync env add <project> KEY=value` — values as CLI args are forbidden.
- [x] Implement rejection logic: if key contains `=`, check if value part is present; if so, error.

**Test plan:**

- *Unit tests*:
  - Key without `=` → prompts for value.
  - Key with `=` and value → error "cannot pass secret values as arguments".
  - `--stdin` reads correctly.
  - Hidden input configured (password type).

- *Security tests* (`test/security/cli-args.test.ts`):
  - `env add STRIPE_KEY=sk_live_123` → non-zero exit, error about CLI args.
  - `env add STRIPE_KEY` (then stdin) → success.
  - `env add STRIPE_KEY --stdin` → success.
  - Process title does not contain secret values.

- *E2E tests*:
  - Full flow: `init` → `env add KEY --stdin` (piped) → `env list` shows key name.

**Acceptance criteria:**
- Secrets never in CLI arguments, shell history, or process list.
- Hidden input for interactive mode.

**Done when:**
- [x] All tests passing in CI.

---

### Task 5.4 — `ctx-sync env scan` command ✅

**Implementation tasks:**
- [x] Add to env command:
  - `ctx-sync env scan <project>` — reads current shell environment, filters project-related vars, prompts for selection, imports selected.

**Test plan:**

- *Unit tests*:
  - Reads `process.env`.
  - Filters correctly.
  - Prompts user for selection.

- *E2E tests*:
  - `init` → set env vars → `env scan` → variables tracked.

**Acceptance criteria:**
- Users can import from current shell environment interactively.

**Done when:**
- [x] All tests passing in CI.

---

### Task 5.5 — `ctx-sync env list` command ✅

**Implementation tasks:**
- [x] Add to env command:
  - `ctx-sync env list <project>` — decrypts and lists key names (values hidden).
  - `ctx-sync env list <project> --show-values` — shows decrypted values (with warning).

**Test plan:**

- *Unit tests*:
  - Without `--show-values`: values are masked/hidden.
  - With `--show-values`: values shown.
  - Empty project → "No environment variables."

- *E2E tests*:
  - `init` → `env import` → `env list` → shows key names.
  - `env list --show-values` → shows values.

**Acceptance criteria:**
- Values hidden by default.
- Explicit flag required to reveal.

**Done when:**
- [x] All tests passing in CI.

---

## Phase 6 — Sync Commands (`sync`, `push`, `pull`) ✅

> **Goal:** Wire up the sync flow — commit encrypted state, push/pull via Git.
>
> **Status:** Complete. All 2 tasks done. Sync command (bidirectional), push command (unidirectional commit+push), pull command (unidirectional pull+conflict detection), comprehensive tests.

### Task 6.1 — `ctx-sync sync` command ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/sync.ts`:
  - Pull latest from remote (if remote exists).
  - Handle merge conflicts on encrypted files (never auto-merge `.age` files — prompt user).
  - Commit all `.age` files + `manifest.json`.
  - Push to remote.
  - Validate remote URL before every operation.
  - Show spinner during operations.

**Test plan:**

- *Unit tests*:
  - Pull → commit → push sequence.
  - Remote validation called.
  - No commit if no changes.
  - Merge conflict on `.age` file → prompts user, does not auto-merge.

- *Integration tests* (`test/integration/sync-workflow.test.ts`):
  - Machine A: init → track → sync. Machine B: init --restore → verify state synced.
  - Only `.age` files + `manifest.json` in git.
  - No plaintext in git log.

- *E2E tests*:
  - Full sync flow between two temp directories.
  - Offline mode (no remote) → local commit only.

- *Security tests* (`test/security/merge-conflict.test.ts`):
  - Conflicting `.age` files never auto-merged.
  - Conflicts prompt user resolution.

**Acceptance criteria:**
- State syncs correctly between machines.
- Only encrypted files in Git.
- Transport validated every time.
- Merge conflicts handled safely.

**Done when:**
- [x] All tests passing in CI.

---

### Task 6.2 — `ctx-sync push` and `ctx-sync pull` commands ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/push.ts` — commit + push only.
- [x] Create `apps/cli/src/commands/pull.ts` — pull + decrypt only.
- [x] Both validate remote URL.

**Test plan:**

- *Unit tests*:
  - Push commits and pushes.
  - Pull fetches and decrypts.
  - Both validate transport.

- *E2E tests*:
  - `push` then `pull` on different dir → state matches.

**Acceptance criteria:**
- Unidirectional sync options available.

**Done when:**
- [x] All tests passing in CI.

---

## Phase 7 — Restore Command & Command-Execution Safety

> **Goal:** Restore project state on a new machine, with mandatory command confirmation.

### Task 7.1 — Command validator module ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/core/command-validator.ts`:
  - `validateCommand(cmd)` — returns `{ suspicious: bool, reason: string }`.
  - Flag: `curl|wget … | sh|bash`, `rm -rf`, `nc -e`, `python -c`, `$(…)`, `eval`, reverse shells.
  - `presentCommandsForApproval(commands)` — formatted display of commands with [y/N/select].
  - No `--yes` or `--no-confirm` flag (cannot bypass confirmation).

**Test plan:**

- *Unit tests* (`test/unit/command-validator.test.ts`): ✅ 63 tests passing
  - Each suspicious pattern from testing.md is detected.
  - Safe commands (e.g., `npm run dev`, `docker compose up -d postgres`) are not flagged.

- *Security tests* (`test/security/command-injection.test.ts`): ✅ 57 tests passing
  - All malicious command patterns rejected.
  - Docker images with suspicious names warned.
  - No auto-execution without confirmation.
  - Non-interactive mode skips execution (does not silently run).

**Acceptance criteria:**
- Malicious commands are flagged.
- No command ever runs without explicit user approval.

**Done when:**
- [x] All tests passing in CI.

---

### Task 7.2 — `ctx-sync restore <project>` command ✅

**Implementation tasks:**
- [x] Create `apps/cli/src/commands/restore.ts`:
  - Decrypt all state files.
  - Display project info: directory, branch, env var count.
  - Display mental context (if available).
  - Display commands to be executed (Docker services, auto-start services).
  - Prompt: Execute all? [y/N/select].
  - If `y`: execute all (with spinner per command).
  - If `N`: skip all.
  - If `select`: prompt per-command [Y/n].
  - `--no-interactive`: show commands but skip execution (safe default).
  - Set up env vars in the project directory (write `.env` or export).
  - Checkout correct git branch (if repo exists locally).

**Test plan:**

- *Unit tests* (`test/unit/restore.test.ts`): ✅ 24 tests passing
  - State is decrypted correctly.
  - Commands are displayed before execution.
  - No execution without confirmation.
  - `--no-interactive` shows commands but doesn't execute.

- *Integration tests* (`test/integration/restore-workflow.test.ts`): ✅ 6 tests passing
  - Full cycle: init → track → sync → restore on "new machine."
  - Env vars are correctly restored.
  - Git branch is correct after restore.

- *E2E tests* (`test/e2e/restore.test.ts`): ✅ 9 tests passing
  - Full user workflow as described in product spec.
  - Command confirmation is shown.
  - Non-interactive mode output contains "Skipped (non-interactive mode)".

- *Security tests*: ✅ (covered in command-injection.test.ts)
  - Commands NOT auto-executed.
  - Wrong key → decryption failure, clean error.
  - Tampered state file → decryption failure.

**Acceptance criteria:**
- Restore displays full context and requires command approval.
- < 10 seconds for state restoration (excluding command execution).
- Mental context displayed.
- No execution without confirmation.

**Done when:**
- [x] All tests passing in CI.

---

## Phase 8 — Mental Context (`note`, `show`)

> **Goal:** Track tasks, blockers, breadcrumbs, next steps — the "23-minute problem" solution.

### Task 8.1 — `ctx-sync note <project>` command

**Implementation tasks:**
- [ ] Create `apps/cli/src/commands/note.ts`:
  - Interactive prompts: current task, blockers, next steps, related links, breadcrumbs.
  - Write to `mental-context.age` (encrypted).
  - Support updating existing context (merge, not overwrite).

**Test plan:**

- *Unit tests*:
  - Mental context structure is correct.
  - Updates merge with existing data.

- *Integration tests*:
  - Write context → read back → data matches.
  - `mental-context.age` is encrypted on disk.

- *E2E tests*:
  - `init` → `track` → `note` → `show` → displays context.

- *Security tests*:
  - No plaintext mental context on disk.
  - No plaintext in git history.

**Acceptance criteria:**
- Users can record and update mental context.
- Context is encrypted.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 8.2 — `ctx-sync show <project>` command

**Implementation tasks:**
- [ ] Create `apps/cli/src/commands/show.ts`:
  - Decrypt and display full project context: state, env var count, mental context, Docker services, running services.
  - Formatted, readable output with chalk.

**Test plan:**

- *Unit tests*:
  - Output formatting is correct.
  - Handles missing sections gracefully.

- *E2E tests*:
  - `show` after tracking → displays all sections.
  - `show` with no mental context → omits that section.

**Acceptance criteria:**
- Full context visible at a glance.

**Done when:**
- [ ] All tests passing in CI.

---

## Phase 9 — Docker / Container State

> **Goal:** Track and restore Docker compose services.

### Task 9.1 — Docker state tracking

**Implementation tasks:**
- [ ] Create `apps/cli/src/core/docker-handler.ts`:
  - `detectDockerCompose(projectDir)` — finds `docker-compose.yml` / `compose.yml`.
  - `parseComposeFile(filePath)` — extracts services, ports, images, volumes.
  - `getRunningContainers(projectDir)` — queries Docker for current state.
  - `saveDockerState(project, state, publicKey)` — encrypts to `docker-state.age`.

**Test plan:**

- *Unit tests*:
  - Parse a sample `docker-compose.yml` → correct service list.
  - Handle missing Docker gracefully (Docker not installed).
  - Handle missing compose file gracefully.

- *Integration tests*:
  - Write docker state → read back → matches.
  - Docker state encrypted on disk.

**Acceptance criteria:**
- Docker compose files parsed correctly.
- State encrypted.
- Missing Docker → graceful message, not crash.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 9.2 — `ctx-sync docker` commands

**Implementation tasks:**
- [ ] Create `apps/cli/src/commands/docker.ts`:
  - `ctx-sync docker start <project>` — shows Docker commands for approval, then executes approved ones.
  - `ctx-sync docker stop <project>` — stops tracked services.
  - `ctx-sync docker status` — shows running services.
- [ ] All start commands go through command validator (approval required).

**Test plan:**

- *Unit tests*:
  - Commands shown for approval.
  - Docker images displayed explicitly.
  - No auto-execution.

- *E2E tests*:
  - Track project with compose file → `docker status` → shows services.
  - `docker start` → shows commands for approval (non-interactive skips).

- *Security tests*:
  - Suspicious Docker images flagged.
  - No auto-pull without confirmation.

**Acceptance criteria:**
- Docker services managed through CLI with safety guards.

**Done when:**
- [ ] All tests passing in CI.

---

## Phase 10 — Running Services & Working Directories

> **Goal:** Track dev servers, ports, recent/pinned directories.

### Task 10.1 — Services state tracking

**Implementation tasks:**
- [ ] Create `apps/cli/src/core/services-handler.ts`:
  - Track service name, port, command, auto-start flag.
  - Write to `services.age`.
  - On restore: display commands for approval (same pattern as Docker).

**Test plan:**

- *Unit tests*:
  - Services saved/loaded correctly.
  - Services encrypted.

- *Integration tests*:
  - Round-trip: save → encrypt → decrypt → load.

**Acceptance criteria:**
- Services tracked and encrypted.
- Restore shows commands for approval.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 10.2 — Working directories tracking

**Implementation tasks:**
- [ ] Create `apps/cli/src/core/directories-handler.ts`:
  - Track recent dirs (path, frequency, last visit).
  - Track pinned dirs.
  - Write to `directories.age`.
  - Path validation on all directory entries.

**Test plan:**

- *Unit tests*:
  - Directories saved/loaded correctly.
  - Path validation applied.
  - Frequency counting works.

- *Security tests*:
  - Directories encrypted on disk.
  - Path traversal rejected.

**Acceptance criteria:**
- Directory state tracked and encrypted.

**Done when:**
- [ ] All tests passing in CI.

---

## Phase 11 — Key Rotation, Verification & Audit

> **Goal:** Key lifecycle management and security audit command.

### Task 11.1 — `ctx-sync key rotate` command

**Implementation tasks:**
- [ ] Create `apps/cli/src/commands/key.ts`:
  - `key rotate`:
    1. Generate new key pair.
    2. Decrypt ALL `.age` files with old key.
    3. Re-encrypt ALL with new key.
    4. Save new private key (0o600).
    5. Rewrite Git history to remove old encrypted blobs.
    6. Force-push to remote.
    7. Prompt to backup new key.
    8. Display warning: other machines must run `key update`.

**Test plan:**

- *Unit tests*:
  - New key generated.
  - All state files re-encrypted.
  - Old key cannot decrypt new files.

- *Integration tests* (`test/integration/key-rotation.test.ts`):
  - Full rotation cycle: init → add data → rotate → verify old key fails, new key works.
  - Git history rewritten.

- *E2E tests* (`test/e2e/key-rotation.test.ts`):
  - Machine A rotates → Machine B with new key → works.
  - Machine C with old key → fails.

- *Security tests* (`test/security/key-management.test.ts`):
  - Old key cannot decrypt any file after rotation.
  - Git history contains no old encrypted blobs.

**Acceptance criteria:**
- Key rotation re-encrypts everything.
- Old key is useless after rotation.
- Git history cleaned.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 11.2 — `ctx-sync key show` / `key verify` / `key update` commands

**Implementation tasks:**
- [ ] `key show` — display public key only (NEVER private key).
- [ ] `key verify` — check: key file exists, permissions 0o600, config dir 0o700, key is valid.
- [ ] `key update` — prompt for new private key (after rotation on another machine), save with 0o600.

**Test plan:**

- *Unit tests*:
  - `key show` returns public key string.
  - `key verify` checks permissions.
  - `key update` saves new key.

- *Security tests*:
  - `key show` never outputs private key.
  - `key verify` detects insecure permissions.

**Acceptance criteria:**
- Key management commands work correctly and securely.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 11.3 — `ctx-sync audit` command

**Implementation tasks:**
- [ ] Create `apps/cli/src/commands/audit.ts`:
  - Check key file permissions.
  - Check config directory permissions.
  - Validate remote transport security.
  - Scan Git history for plaintext leaks.
  - Verify all state files are `.age` (not `.json`).
  - Report repo size.
  - Report any issues with severity levels.

**Test plan:**

- *Unit tests*:
  - Each check individually tested.
  - Report format correct.

- *Integration tests*:
  - Full audit on a clean setup → all green.
  - Audit with insecure permissions → reports issue.
  - Audit with HTTP remote → reports issue.

- *E2E tests*:
  - `init` → `track` → `sync` → `audit` → all checks pass.

**Acceptance criteria:**
- Comprehensive security audit available to users.
- Clear, actionable output.

**Done when:**
- [ ] All tests passing in CI.

---

## Phase 12 — Team / Multi-Recipient Support

> **Goal:** Multi-user encryption, key addition/revocation.

### Task 12.1 — Multi-recipient encryption

**Implementation tasks:**
- [ ] Extend `encryption.ts`:
  - `encryptForRecipients(plaintext, publicKeys[])` — encrypts for multiple Age recipients.
  - `getRecipients(configDir)` — reads recipients list.
  - `addRecipient(configDir, name, publicKey)` — adds to recipients.
  - `removeRecipient(configDir, publicKey)` — removes and re-encrypts all state.

**Test plan:**

- *Unit tests*:
  - Encrypt for 2 recipients → both can decrypt.
  - Remove recipient → removed recipient cannot decrypt new files.

- *Security tests* (`test/security/key-management.test.ts`):
  - After revocation, revoked key cannot decrypt.
  - Re-encryption is complete (all files).

**Acceptance criteria:**
- Multi-recipient encryption works.
- Revocation is immediate and complete.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 12.2 — `ctx-sync team` commands

**Implementation tasks:**
- [ ] Create `apps/cli/src/commands/team.ts`:
  - `team add --name <n> --key <pubkey>` — verify fingerprint prompt, add recipient.
  - `team remove <name>` — remove + re-encrypt.
  - `team list` — list members and public keys.
  - `team revoke <pubkey>` — immediate revocation + re-encrypt.

**Test plan:**

- *Unit tests*:
  - Add/remove/list/revoke flows.
  - Fingerprint verification prompt.

- *Integration tests*:
  - Add member → encrypt → both decrypt.
  - Revoke member → re-encrypt → revoked member fails.

- *E2E tests*:
  - Full team workflow.

**Acceptance criteria:**
- Team members can be managed securely.
- Revocation is immediate.

**Done when:**
- [ ] All tests passing in CI.

---

## Phase 13 — Config & Safe-List Management

> **Goal:** User-configurable safe-list and local preferences.

### Task 13.1 — `ctx-sync config safe-list` commands

**Implementation tasks:**
- [ ] Create `apps/cli/src/commands/config.ts`:
  - `config safe-list` — view current safe-list (default + custom).
  - `config safe-list add <key>` — add key to user's safe-list.
  - `config safe-list remove <key>` — remove key (will be encrypted on next sync).
- [ ] Safe-list stored in `~/.config/ctx-sync/config.json` (local, never synced).

**Test plan:**

- *Unit tests*:
  - Add/remove/list operations on safe-list.
  - Default safe-list always present.
  - Custom additions merge with defaults.

- *E2E tests*:
  - Add custom key to safe-list → `env import --allow-plain` → that key treated as plain.
  - Remove from safe-list → key encrypted on next import.

**Acceptance criteria:**
- Safe-list is customizable.
- Changes apply correctly to future imports.

**Done when:**
- [ ] All tests passing in CI.

---

## Phase 14 — Security Hardening & Penetration Tests

> **Goal:** Comprehensive automated security test suite covering all attack vectors from the threat model.

### Task 14.1 — Log sanitizer module

**Implementation tasks:**
- [ ] Create `apps/cli/src/core/log-sanitizer.ts`:
  - `sanitizeForLog(message)` — redacts Stripe keys, GitHub tokens, passwords, PEM keys, etc.
  - Wrap all console output through sanitizer.
  - `DEBUG=*` mode never outputs decrypted values.

**Test plan:**

- *Unit tests* (`test/unit/log-sanitizer.test.ts`):
  - Each pattern from product spec is redacted.
  - Safe values pass through unchanged.

- *Security tests* (`test/security/secret-leak.test.ts`):
  - With `DEBUG=*`, no secret values in output.
  - Error messages do not contain secrets.
  - Stack traces do not contain secrets.

**Acceptance criteria:**
- No secret ever appears in any log output.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 14.2 — Full penetration test suite

**Implementation tasks:**
- [ ] Create `test/security/pentest.test.ts` with all scenarios from testing.md:
  - Secret exposure via logs (DEBUG mode).
  - Stack trace sanitization.
  - Git history analysis (full history scan for token patterns).
  - Tampered state file detection.
  - Replaced state file detection (attacker's key).
  - Fuzzing: malformed `.env` files (empty, no key, no value, null bytes, very long values, binary data, duplicates, Windows line endings, `export` syntax).
  - Fuzzing: malformed Age ciphertext (empty, garbage, corrupted).

**Test plan:**

- All tests defined in `test/security/pentest.test.ts` per testing.md spec.

**Acceptance criteria:**
- All penetration tests pass.
- No crashes on any fuzz input.
- No secret leaks under any condition.

**Done when:**
- [ ] All tests passing in CI.
- [ ] Security job green.

---

### Task 14.3 — CI secret scanning

**Implementation tasks:**
- [ ] Finalize `tooling/ci/check-secrets.sh`:
  - Scans test output directories for patterns: `sk_live_`, `sk_test_`, `ghp_`, `xoxb-`, `AKIA`, `AGE-SECRET-KEY-`.
  - Exits non-zero if any found.
- [ ] Ensure this runs in CI security job.

**Test plan:**
- Integration: Intentionally leave a secret in test output → CI job fails.

**Acceptance criteria:**
- Accidental secret leaks in CI artifacts are caught.

**Done when:**
- [ ] CI job configured and verified.

---

## Phase 15 — Performance Benchmarking

> **Goal:** Verify performance meets product spec requirements.

### Task 15.1 — Performance test suite

**Implementation tasks:**
- [ ] Create `test/performance/benchmarks.test.ts`:
  - Encrypt 100 secrets in < 1 second.
  - Handle state with 1000 projects: save + load in < 100ms.
  - Full sync in < 3 seconds.
  - Single encryption operation < 100ms.
- [ ] Create `test/performance/load-test.sh`:
  - Track 100 projects.
  - Add 1000 env vars.
  - Full sync.
  - Restore all projects.
  - Report timing for each.

**Test plan:**
- All benchmarks defined above.

**Acceptance criteria:**
- Encryption: < 100ms per secret.
- State load: < 100ms for 1000 projects.
- Sync: < 3 seconds.
- Storage: < 1MB for 100 projects.

**Done when:**
- [ ] Benchmarks pass.
- [ ] Performance regression can be detected in CI (optional: track over time).

---

## Phase 16 — Polish, UX & Error Handling

> **Goal:** Production-quality error messages, interactive wizards, edge case handling.

### Task 16.1 — Error handling & user-friendly messages

**Implementation tasks:**
- [ ] Create `apps/cli/src/utils/errors.ts`:
  - Custom error classes: `EncryptionError`, `SyncError`, `ConfigError`, `SecurityError`.
  - User-friendly messages with suggested fixes (e.g., "Run `chmod 600 <path>` to fix permissions.").
  - No stack traces in production (only with `--verbose` or `DEBUG=*`).
- [ ] Wrap all top-level command handlers in try/catch with friendly output.

**Test plan:**

- *Unit tests*:
  - Each error class produces correct message format.
  - Stack traces hidden without `--verbose`.

- *E2E tests*:
  - Various error scenarios → friendly messages (no stack traces).
  - Missing git → helpful error.
  - Missing key → helpful error.
  - Corrupted state → helpful error.

**Acceptance criteria:**
- Every error a user might encounter has a clear, actionable message.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 16.2 — Interactive wizards (track flow improvements)

**Implementation tasks:**
- [ ] Enhance `track` command with step-by-step wizard:
  - Auto-detect project name from directory/Git remote.
  - Prompt for `.env` import.
  - Prompt for Docker service tracking.
  - Prompt for mental context.
  - Summary before committing.
- [ ] Add `--yes` flag to skip confirmations (but NOT for command execution on restore).

**Test plan:**

- *E2E tests*:
  - Wizard flow produces correct state.
  - `--yes` skips interactive prompts.

**Acceptance criteria:**
- Smooth, guided UX for project tracking.

**Done when:**
- [ ] All tests passing in CI.

---

### Task 16.3 — Edge case hardening

**Implementation tasks:**
- [ ] Handle all edge cases from manual testing checklist in testing.md:
  - Empty .env file.
  - Missing Git config.
  - No internet connection.
  - Corrupted encrypted state file.
  - Tampered state file.
  - Wrong encryption key.
  - Disk full.
  - Permission errors.
  - Binary data in `.env`.
  - Very long env var values.
  - Null bytes in input.
  - Projects without Git.
  - Projects without `.env`.
  - Docker not installed.

**Test plan:**

- *Unit/integration tests for each edge case listed above.*

**Acceptance criteria:**
- No crash on any edge case.
- Clear error messages for all.

**Done when:**
- [ ] All tests passing in CI.
- [ ] Manual testing checklist from testing.md fully satisfied.

---

## Phase 17 — Marketing + Documentation Website

> **Goal:** Vanilla HTML/CSS/JS website with marketing landing page + product documentation.

### Task 17.1 — Website project setup

**Implementation tasks:**
- [ ] Set up `apps/website/package.json` with:
  - `"build": "npx tsx scripts/build-docs.ts"`
  - `"serve": "npx serve public"`
  - `"dev": "npx serve public"` (for local development)
- [ ] Install minimal dev deps: `marked` (Markdown → HTML), `serve` (local dev server).
- [ ] Create `apps/website/scripts/build-docs.ts`:
  - Reads Markdown files from `content/`.
  - Converts to HTML using `marked`.
  - Injects into a shared layout template (HTML string, no framework).
  - Writes to `public/docs/*.html`.
  - Generates a sidebar nav from file list.
  - Generates a simple search index (JSON file of titles + headings + content snippets).

**Test plan:**

- *Unit tests* (in website package):
  - Build script converts Markdown to valid HTML.
  - Layout template is applied.
  - Search index is generated.
  - Broken links are detected.

**Acceptance criteria:**
- `npm run build -w apps/website` produces complete HTML files.
- All pages render correctly in a browser.

**Done when:**
- [ ] Build succeeds.
- [ ] All tests pass.

---

### Task 17.2 — Marketing landing page

**Implementation tasks:**
- [ ] Create `apps/website/public/index.html`:
  - Hero section: headline, subheadline, CTA (install command).
  - Problem statement section (the 23-minute context switch tax).
  - Features section (P0 features with icons/illustrations).
  - How it works section (3-step flow: track → sync → restore).
  - Security section (encrypt-everything, no backend, zero-trust).
  - Comparison table (vs Atuin, vs dotfiles managers, vs cloud IDEs).
  - Getting started section (install + init commands).
  - Footer with links to docs, GitHub, license.
- [ ] Create `apps/website/public/css/main.css`:
  - Modern, clean design. Dark/light mode support.
  - Responsive (mobile-first).
  - CSS variables for theming.
  - No CSS frameworks.
- [ ] Create `apps/website/public/js/main.js`:
  - Smooth scrolling.
  - Mobile nav toggle.
  - Dark/light mode toggle.
  - Copy-to-clipboard on install commands.
  - Minimal animations (CSS transitions, not JS-heavy).

**Test plan:**

- *Manual*: Visual review on desktop + mobile.
- *CI*: HTML validation (no broken tags). Check all links resolve.

**Acceptance criteria:**
- Landing page is visually polished and professional.
- Responsive on mobile and desktop.
- All content matches product spec.
- No JavaScript frameworks used.

**Done when:**
- [ ] Page renders correctly.
- [ ] HTML validation passes.
- [ ] Responsive check passes.

---

### Task 17.3 — Documentation pages

**Implementation tasks:**
- [ ] Create Markdown content files in `apps/website/content/`:
  - `getting-started.md` — installation, first setup, first project tracking.
  - `commands.md` — full CLI reference (all commands from product spec).
  - `security.md` — security model, encryption, threat model, key management.
  - `teams.md` — multi-recipient setup, key sharing, revocation.
  - `faq.md` — common questions and troubleshooting.
- [ ] Create `apps/website/public/docs/index.html` — docs landing with links to all pages.
- [ ] Create `apps/website/public/css/docs.css`:
  - Sidebar navigation.
  - Content area with good typography.
  - Code block styling (syntax highlighting via CSS classes — no heavy JS libs).
  - Responsive sidebar (collapses on mobile).
- [ ] Create `apps/website/public/js/docs-nav.js`:
  - Active page highlighting in sidebar.
  - Collapsible sections.
  - Mobile sidebar toggle.
- [ ] Create `apps/website/public/js/docs-search.js`:
  - Client-side search using pre-built JSON index.
  - Search input in sidebar.
  - Results displayed inline (no server needed).
  - Highlights matching terms.

**Test plan:**

- *Unit tests*:
  - Build script produces all expected HTML files.
  - Search index contains entries for each page.
  - No broken internal links.

- *Manual*:
  - Navigate all docs pages.
  - Search for terms → results match.
  - Sidebar navigation works on mobile.

**Acceptance criteria:**
- All docs pages generated from Markdown.
- Client-side search works.
- Navigation is smooth and accessible.
- Content covers all CLI commands and security model.

**Done when:**
- [ ] All docs pages build and render.
- [ ] Search works.
- [ ] All tests pass.

---

### Task 17.4 — Website CI & deployment

**Implementation tasks:**
- [ ] Add website build + validation to CI pipeline (`.github/workflows/ci.yml`).
- [ ] Add deployment step to `.github/workflows/release.yml`:
  - Build docs.
  - Deploy `public/` to GitHub Pages (or Cloudflare Pages / Netlify).
- [ ] Add a simple HTML validator step (e.g., `html-validate` or `vnu-jar`).
- [ ] Add broken link checker.

**Test plan:**

- *CI*: Website build → validation → no errors.

**Acceptance criteria:**
- Website deploys automatically on release.
- No HTML validation errors.
- No broken links.

**Done when:**
- [ ] Deployment pipeline works.
- [ ] All checks pass.

---

## Phase 18 — Release Preparation & Launch

> **Goal:** Final testing, documentation review, npm publish, public launch.

### Task 18.1 — Full test suite green

**Implementation tasks:**
- [ ] Run complete test suite: `npm run test:all -w apps/cli`.
- [ ] Run security suite: `npm run test:security -w apps/cli`.
- [ ] Run penetration tests: `npm run test:pentest -w apps/cli`.
- [ ] Run performance benchmarks: `npm run test:performance -w apps/cli`.
- [ ] Verify CI matrix all green (ubuntu × macOS, Node 18 × 20).
- [ ] Verify coverage ≥ 80 % lines globally, 100 % on critical paths.
- [ ] Fix any remaining failures.

**Test plan:**
- All existing tests.

**Acceptance criteria:**
- Zero test failures.
- All coverage gates met.
- All security checks pass.

**Done when:**
- [ ] CI fully green.

---

### Task 18.2 — Manual testing checklist completion

**Implementation tasks:**
- [ ] Walk through EVERY item in the manual testing checklist from testing.md:
  - Initial setup (install, version, help, init, key backup, remote validation).
  - Project tracking (track, detect git, detect .env, detect docker-compose, path validation).
  - Environment variables (import, encrypt-by-default, scan, add interactive, add stdin, list).
  - Docker integration (detect, track, restore with confirmation).
  - Syncing (commit, push, pull, merge conflicts, transport validation).
  - Restoration (new machine, key restore, env decrypt, command approval).
  - Mental context (add, track blockers, breadcrumbs, display on restore).
  - Key management (show, rotate, verify, update, team revoke).
  - Security audit (permissions, transport, history scan, repo size, encryption verification).
  - All edge cases.

**Acceptance criteria:**
- Every checklist item checked off.

**Done when:**
- [ ] Full manual pass complete.

---

### Task 18.3 — CHANGELOG & version bump

**Implementation tasks:**
- [ ] Write comprehensive CHANGELOG for v1.0.0.
- [ ] Bump version in `apps/cli/package.json` and root `package.json`.
- [ ] Update README.md with:
  - Project description.
  - Installation instructions.
  - Quick start guide.
  - Link to full documentation.
  - Security model summary.
  - Contributing guidelines.
  - License.

**Acceptance criteria:**
- CHANGELOG covers all features.
- Version is correct everywhere.
- README is comprehensive and welcoming.

**Done when:**
- [ ] Committed to release branch.

---

### Task 18.4 — npm publish & website deploy

**Implementation tasks:**
- [ ] Create release branch `release/v1.0.0` from `develop`.
- [ ] Final CI run → all green.
- [ ] Merge to `main`.
- [ ] Tag `v1.0.0` on `main`.
- [ ] CI publishes `ctx-sync` to npm.
- [ ] CI deploys website to hosting.
- [ ] Verify: `npm install -g ctx-sync` works from a clean machine.
- [ ] Verify: website is live and all pages load.
- [ ] Back-merge `main` → `develop`.

**Acceptance criteria:**
- `npm install -g ctx-sync` → `ctx-sync --version` → prints `1.0.0`.
- Website live at target URL.
- All documentation accessible.

**Done when:**
- [ ] v1.0.0 is live.
- [ ] Users can install and use the tool.

---

## Appendix A — Dependency Summary

### `apps/cli` dependencies

| Package | Purpose | Version Policy |
|---------|---------|---------------|
| `simple-git` | Git operations | Latest stable |
| `age-encryption` | Age encryption/decryption | Latest stable |
| `commander` | CLI framework | Latest stable |
| `chalk` | Terminal colors | Latest stable (ESM-aware) |
| `ora` | Spinners | Latest stable |
| `enquirer` | Interactive prompts | Latest stable |
| `execa` | Shell command execution | Latest stable |
| `chokidar` | File watching (future: auto-save) | Latest stable |

### `apps/cli` devDependencies

| Package | Purpose |
|---------|---------|
| `jest` | Test runner |
| `ts-jest` | TypeScript Jest transformer |
| `@types/jest` | Jest type definitions |
| `@types/mock-fs` | mock-fs type definitions |
| `mock-fs` | Filesystem mocking |
| `tmp` | Temp directory management |
| `nock` | HTTP mocking |
| `@faker-js/faker` | Test data generation |

### `apps/website` devDependencies

| Package | Purpose |
|---------|---------|
| `marked` | Markdown → HTML conversion |
| `serve` | Local dev server |

### Root devDependencies

| Package | Purpose |
|---------|---------|
| `typescript` | TypeScript compiler (5.x) |
| `@types/node` | Node.js type definitions |
| `tsx` | TypeScript execution for scripts & dev |
| `eslint` | Linting |
| `@eslint/js` | ESLint core JS rules |
| `typescript-eslint` | TypeScript ESLint parser + plugin (v8+) |
| `prettier` | Formatting |
| `eslint-config-prettier` | ESLint + Prettier harmony |
| `eslint-plugin-import` | Import ordering & validation |
| `husky` | Git hooks |
| `@commitlint/cli` | Commit message enforcement |
| `@commitlint/config-conventional` | Conventional commits config |

---

## Appendix B — Quality Gates Summary

| Gate | Threshold | Enforced By |
|------|-----------|-------------|
| **TypeScript type-check** | **0 errors (`tsc --noEmit`)** | **CI lint-and-typecheck job + pre-commit hook** |
| **No `any` without justification** | **0 bare `any` types** | **`@typescript-eslint/no-explicit-any: warn` + review** |
| Unit test coverage (lines) | ≥ 80 % | `jest --coverage` + CI gate |
| Unit test coverage (branches) | ≥ 80 % | `jest --coverage` + CI gate |
| Unit test coverage (functions) | ≥ 80 % | `jest --coverage` + CI gate |
| Critical path coverage | 100 % | Manual review |
| Security test coverage | 100 % of threat model vectors | `test:security` suite |
| Lint errors (incl. TS rules) | 0 | `eslint` (with `typescript-eslint`) + pre-commit hook |
| npm audit | 0 moderate+ | CI security job |
| Plaintext secret scan | 0 matches | `check-secrets.sh` in CI |
| Performance: encryption | < 100ms per secret | `test:performance` |
| Performance: sync | < 3 seconds | `test:performance` |
| Performance: state load | < 100ms for 1000 projects | `test:performance` |
| HTML validation (website) | 0 errors | CI website job |
| Broken links (website) | 0 | CI website job |

---

## Appendix C — Test File Inventory

When all phases are complete, the test directory should contain:

```
apps/cli/test/
├── tsconfig.json               # Test-specific TS config (extends ../tsconfig.json)
├── setup.ts                    # Global test setup (TEST_DIR, cleanup)
├── unit/
│   ├── encryption.test.ts
│   ├── key-store.test.ts
│   ├── secure-memory.test.ts
│   ├── git-sync.test.ts
│   ├── transport.test.ts
│   ├── state-manager.test.ts
│   ├── path-validator.test.ts
│   ├── env-handler.test.ts
│   ├── command-validator.test.ts
│   ├── log-sanitizer.test.ts
│   ├── docker-handler.test.ts
│   ├── services-handler.test.ts
│   ├── directories-handler.test.ts
│   ├── init.test.ts
│   ├── track.test.ts
│   ├── list.test.ts
│   ├── status.test.ts
│   ├── sync.test.ts
│   ├── push.test.ts
│   ├── pull.test.ts
│   ├── restore.test.ts
│   ├── note.test.ts
│   ├── show.test.ts
│   ├── docker.test.ts
│   ├── env-import.test.ts
│   ├── env-add.test.ts
│   ├── env-scan.test.ts
│   ├── env-list.test.ts
│   ├── key.test.ts
│   ├── team.test.ts
│   ├── config.test.ts
│   ├── audit.test.ts
│   └── errors.test.ts
├── integration/
│   ├── encryption-workflow.test.ts
│   ├── git-operations.test.ts
│   ├── init-workflow.test.ts
│   ├── restore-workflow.test.ts
│   ├── sync-workflow.test.ts
│   ├── track-workflow.test.ts
│   └── key-rotation.test.ts
├── e2e/
│   ├── helpers/
│   │   └── test-env.ts
│   ├── cli-basics.test.ts
│   ├── init.test.ts
│   ├── init-restore.test.ts
│   ├── track.test.ts
│   ├── env.test.ts
│   ├── sync.test.ts
│   ├── restore.test.ts
│   ├── note-show.test.ts
│   ├── docker.test.ts
│   ├── key-rotation.test.ts
│   ├── multi-machine.test.ts
│   └── user-workflow.test.ts
├── security/
│   ├── state-encryption.test.ts
│   ├── secret-leak.test.ts
│   ├── command-injection.test.ts
│   ├── cli-args.test.ts
│   ├── file-permissions.test.ts
│   ├── transport.test.ts
│   ├── key-management.test.ts
│   ├── path-traversal.test.ts
│   ├── memory-safety.test.ts
│   ├── merge-conflict.test.ts
│   └── pentest.test.ts
├── performance/
│   ├── benchmarks.test.ts
│   └── load-test.sh
├── fixtures/
│   ├── sample.env
│   ├── sample-docker-compose.yml
│   ├── sample-state.json
│   └── malformed-inputs/
│       ├── empty.env
│       ├── binary.env
│       ├── null-bytes.env
│       └── very-long.env
└── helpers/
    ├── test-env.ts
    ├── mock-git.ts
    └── crypto-helpers.ts
```

---

## Appendix D — Phase Dependency Graph

```
Phase 0  (Scaffolding)
   │
   ▼
Phase 1  (Encryption)  ──────────────────────┐
   │                                         │
   ▼                                         │
Phase 2  (Git Sync)                          │
   │                                         │
   ▼                                         │
Phase 3  (CLI + init)                        │
   │                                         │
   ├──────────────┐                          │
   ▼              ▼                          │
Phase 4        Phase 5                       │
(track/list)   (env vars)                    │
   │              │                          │
   └──────┬───────┘                          │
          ▼                                  │
       Phase 6  (sync)                       │
          │                                  │
          ▼                                  │
       Phase 7  (restore + cmd safety)       │
          │                                  │
   ┌──────┼──────────┬──────────┐            │
   ▼      ▼          ▼          ▼            │
Phase 8  Phase 9   Phase 10  Phase 11        │
(mental) (docker)  (services) (key mgmt)     │
   │      │          │          │            │
   └──────┴──────────┴──────────┘            │
          │                                  │
          ▼                                  │
       Phase 12 (teams)                      │
          │                                  │
          ▼                                  │
       Phase 13 (config/safe-list)           │
          │                                  │
          ▼                                  │
       Phase 14 (security hardening)  ◄──────┘
          │
          ▼
       Phase 15 (performance)
          │
          ▼
       Phase 16 (polish/UX)
          │
          ├──────────────────────┐
          ▼                      ▼
       Phase 17              Phase 18
       (website)             (release)
          │                      │
          └──────────┬───────────┘
                     ▼
                  🚀 LAUNCH
```

**Parallelizable:** Phases 8, 9, 10, and 11 can be worked on in parallel after Phase 7 is complete. Phase 17 (website) can begin as early as Phase 6, since it depends mostly on product knowledge, not CLI code.

---

*Document Version: 1.1 (updated: TypeScript + strict linting throughout)*
*Generated: 2026-02-10*
*Source specs: product.md, testing.md*
