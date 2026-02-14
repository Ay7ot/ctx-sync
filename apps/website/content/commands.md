# CLI Commands Reference

Complete reference for all ctx-sync commands.

## Setup Commands

### `ctx-sync init`

Initialize ctx-sync on a new machine. Generates encryption keys and sets up the sync repository.

```bash
ctx-sync init
```

The remote URL should point to a **dedicated private repository** you created for ctx-sync (e.g. `git@github.com:you/dev-context.git`), not one of your project repos. See [Getting Started](./getting-started.html) for setup steps.

**Options:**

| Flag | Description |
|------|-------------|
| `--restore` | Restore mode — paste an existing private key instead of generating a new one |
| `--skip-backup` | Skip the key backup prompt (not recommended) |
| `--remote <url>` | Git remote URL for syncing (SSH or HTTPS) |
| `--no-interactive` | Skip interactive prompts (use defaults) |
| `--stdin` | Read private key from stdin (for `--restore`) |

### `ctx-sync init --restore`

Set up ctx-sync on a new machine using an existing private key.

```bash
ctx-sync init --restore
```

You will be prompted to paste your private key and provide the Git remote URL.

## Project Management

### `ctx-sync track`

Track the current project. Auto-detects Git state, .env files, Docker services, and prompts for mental context.

```bash
ctx-sync track
```

**Options:**

| Flag | Description |
|------|-------------|
| `--yes` | Skip confirmation prompts (auto-accept defaults) |
| `--no-interactive` | Non-interactive mode for CI/scripts |

### `ctx-sync list`

List all tracked projects.

```bash
ctx-sync list
```

### `ctx-sync status`

Show the sync status — pending changes, last sync time, and remote state.

```bash
ctx-sync status
```

### `ctx-sync restore <project>`

Restore a project's full context on the current machine.

```bash
ctx-sync restore my-app
```

This displays your mental context, decrypts environment variables, and shows all commands (Docker, services) for explicit approval before execution.

:::security Command Approval Required
Commands are always shown for review before execution. There is no flag to skip command confirmation. This prevents remote code execution from compromised repos.
:::

## Environment Variables

### `ctx-sync env import <file>`

Import environment variables from a .env file. All values are encrypted by default.

```bash
ctx-sync env import .env
```

**Options:**

| Flag | Description |
|------|-------------|
| `--stdin` | Read from stdin instead of a file |
| `--allow-plain` | Allow safe-listed keys to be stored unencrypted |

### `ctx-sync env add <key>`

Add a single environment variable. Value is entered via hidden interactive prompt — never passed as a CLI argument.

```bash
ctx-sync env add STRIPE_KEY
```

**Options:**

| Flag | Description |
|------|-------------|
| `--stdin` | Read value from stdin pipe |
| `--from-fd N` | Read value from file descriptor N |

:::warning Never Pass Secrets as Arguments
Values are never accepted as CLI arguments to prevent exposure in shell history and process lists. Use interactive prompt, stdin, or file descriptor instead.
:::

### `ctx-sync env scan`

Scan the current shell environment and select variables to track.

```bash
ctx-sync env scan my-app
```

### `ctx-sync env list <project>`

List all tracked environment variables for a project. Values are hidden by default.

```bash
ctx-sync env list my-app
```

**Options:**

| Flag | Description |
|------|-------------|
| `--show-values` | Show decrypted values (use with caution) |

## Syncing

### `ctx-sync sync`

Sync context with the remote — pushes local changes and pulls remote updates.

```bash
ctx-sync sync
```

### `ctx-sync push`

Push local context to the remote.

```bash
ctx-sync push
```

### `ctx-sync pull`

Pull remote context to the local machine.

```bash
ctx-sync pull
```

## Mental Context

### `ctx-sync note <project>`

Update mental context — current task, blockers, next steps, breadcrumbs, and links.

```bash
ctx-sync note my-app
```

:::tip Beat the 23-Minute Problem
Use `ctx-sync note` at the end of each session to capture what you were doing, where you left off, and what you planned to do next. Your future self will thank you.
:::

### `ctx-sync show <project>`

Display the full context for a project — Git state, environment variables, Docker services, and mental context.

```bash
ctx-sync show my-app
```

## Docker

### `ctx-sync docker start <project>`

Start tracked Docker services for a project. Commands are shown for confirmation before execution.

```bash
ctx-sync docker start my-app
```

### `ctx-sync docker stop <project>`

Stop tracked Docker services.

```bash
ctx-sync docker stop my-app
```

### `ctx-sync docker status`

Show the status of tracked Docker services.

```bash
ctx-sync docker status
```

## Key Management

### `ctx-sync key show`

Display your public key. The private key is never shown.

```bash
ctx-sync key show
```

### `ctx-sync key rotate`

Rotate your encryption key. Generates a new key pair and re-encrypts all state files.

```bash
ctx-sync key rotate
```

**What it does:**
1. Generates a new key pair
2. Re-encrypts all state files with the new key
3. Rewrites Git history to remove old encrypted blobs
4. Force-pushes to remote

:::danger Coordinate Key Rotation
After rotation, all other machines must run `ctx-sync key update`. Failure to do so will prevent decryption on those machines.
:::

### `ctx-sync key verify`

Verify key file permissions and integrity.

```bash
ctx-sync key verify
```

### `ctx-sync key update`

Update the private key on this machine after a key rotation on another machine.

```bash
ctx-sync key update
```

## Team Management

### `ctx-sync team add`

Add a team member as a recipient for encrypted state.

```bash
ctx-sync team add --name "Alice" --key age1alice...
```

### `ctx-sync team remove <name>`

Remove a team member and re-encrypt all shared state.

```bash
ctx-sync team remove alice
```

### `ctx-sync team list`

List all team members and their public keys.

```bash
ctx-sync team list
```

### `ctx-sync team revoke <pubkey>`

Immediately revoke a key and re-encrypt all shared secrets.

```bash
ctx-sync team revoke age1bob...
```

## Configuration

### `ctx-sync config safe-list`

View the current safe-list of environment variable keys that may be stored unencrypted.

```bash
ctx-sync config safe-list
```

### `ctx-sync config safe-list add <key>`

Add a key to the safe-list.

```bash
ctx-sync config safe-list add MY_SAFE_VAR
```

### `ctx-sync config safe-list remove <key>`

Remove a key from the safe-list.

```bash
ctx-sync config safe-list remove MY_SAFE_VAR
```

## Security

### `ctx-sync audit`

Run a comprehensive security audit of your ctx-sync setup.

```bash
ctx-sync audit
```

**Checks:**
- Key file permissions (must be 600)
- Config directory permissions (must be 700)
- Git remote transport security (SSH or HTTPS only)
- Git history for plaintext leaks
- Repository size
- All state files are encrypted

:::success Run Audits Regularly
Make `ctx-sync audit` part of your routine. It catches permission drift, insecure remotes, and accidentally committed plaintext files.
:::
