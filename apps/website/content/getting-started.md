# Getting Started

Get up and running with ctx-sync in under a minute.

## Installation

Install ctx-sync globally via npm:

```bash
npm install -g ctx-sync
```

:::info Requirements
Requires **Node.js 18+** and **Git** installed on your system.
:::

## Create a Sync Repository

Before running `ctx-sync init`, create a dedicated **private** Git repository to store your encrypted context. This is separate from your project repos — it is a single repo that holds encrypted snapshots of all your projects in one place.

1. Go to [GitHub](https://github.com/new), [GitLab](https://gitlab.com/projects/new), or your preferred Git host.
2. Create a new **private** repository (e.g. `dev-context` or `my-context-sync`).
3. Copy the SSH or HTTPS URL (e.g. `git@github.com:you/dev-context.git`).

:::info This Is Not Your Project Repo
The sync repository is dedicated to ctx-sync and is separate from your project repos. ctx-sync never modifies your project repositories — it only reads their Git state (branch, remote, uncommitted changes). All your encrypted context is stored in `~/.context-sync/` locally and pushed to this dedicated remote.
:::

## First-Time Setup

Run the init command to generate your encryption key and configure your sync repository:

```bash
ctx-sync init
```

This will:

1. **Generate an encryption key pair** — Your private key is saved to `~/.config/ctx-sync/key.txt` with secure permissions (600).
2. **Prompt you to back up your private key** — Save it to a password manager like 1Password or Bitwarden. You will need this key to restore on another machine.
3. **Ask for your Git remote URL** — Paste the URL of the dedicated private repository you created above. ctx-sync will validate that it uses a secure transport (SSH or HTTPS).

:::tip Skipping the Remote
You can press Enter to skip the remote URL during init. ctx-sync will work locally without syncing. To add a remote later, run: `ctx-sync init --remote <url>`
:::

:::info Re-running Init
If you already have a key and just need to update the remote URL, simply run `ctx-sync init` again — it will **reuse your existing key** and only update the remote configuration. To force a new key pair, use `ctx-sync init --force`.
:::

## Back Up Your Key

:::security Key Backup Is Critical
Your private key is the **only way** to decrypt your synced context. If you lose it, your data is gone. There is no backdoor by design. ctx-sync will prompt you to back up during init.
:::

- **Recommended:** Save to 1Password / Bitwarden
- **Alternative:** Copy to clipboard (auto-clears after 30 seconds)

## Track Your First Project

Navigate to any project directory and start tracking:

```bash
cd ~/projects/my-app
ctx-sync track
```

ctx-sync will automatically detect:

- **Git repository** — current branch, remote, uncommitted changes
- **.env file** — prompts to import environment variables (all encrypted by default)
- **docker-compose.yml** — prompts to track Docker services
- **Mental context** — asks what you are currently working on

:::tip Quick Track
Use `ctx-sync track --yes` to skip confirmation prompts and accept all defaults.
:::

## Sync Your Context

Push your tracked context to your Git remote:

```bash
ctx-sync sync
```

All data is encrypted with Age encryption before being committed to Git. Even project names and paths are encrypted — an attacker with access to your Git repo sees only ciphertext.

## Restore on a New Machine

On your new machine, install ctx-sync and restore:

```bash
npm install -g ctx-sync
ctx-sync init --restore
```

Paste your private key when prompted. ctx-sync will clone your context repo and decrypt all your state.

Then restore a specific project:

```bash
ctx-sync restore my-app
```

`restore` automatically pulls the latest state from the remote before decrypting, so you always get the most up-to-date context. If you want to skip the pull (e.g. you are offline), use `--no-pull`:

```bash
ctx-sync restore my-app --no-pull
```

If your project is at a different path on this machine (common when switching between macOS, Linux, and Windows), use `--path` to tell ctx-sync where it lives:

```bash
ctx-sync restore my-app --path ~/code/my-app
```

This will:

- Pull the latest state from the remote (unless `--no-pull` is used)
- Resolve the local project directory (using `--path` if provided, or the stored path)
- Show your mental context (what you were working on, blockers, next steps)
- Decrypt and restore environment variables
- Show Docker services and commands for your approval before executing

:::success Full Context in Seconds
The entire restore process takes under 10 seconds. You go from a blank machine to knowing exactly where you left off.
:::

## Daily Usage

```bash
# Track changes to your context
ctx-sync track

# Add a note about what you are working on
ctx-sync note my-app

# Sync to remote
ctx-sync sync

# Check status
ctx-sync status
```

## Next Steps

- [Full CLI Reference](./commands.html) — All available commands
- [Security Model](./security.html) — How encryption and key management work
- [Team Setup](./teams.html) — Share context with your team
- [FAQ](./faq.html) — Common questions and troubleshooting
