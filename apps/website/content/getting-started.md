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

## First-Time Setup

Run the init command to generate your encryption key and configure your sync repository:

```bash
ctx-sync init
```

This will:

1. **Generate an encryption key pair** — Your private key is saved to `~/.config/ctx-sync/key.txt` with secure permissions (600).
2. **Prompt you to back up your private key** — Save it to a password manager like 1Password or Bitwarden. You will need this key to restore on another machine.
3. **Ask for your Git remote URL** — This is where your encrypted context will be synced. Use a private repository.

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

This will:

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

- [Full CLI Reference](/docs/commands.html) — All available commands
- [Security Model](/docs/security.html) — How encryption and key management work
- [Team Setup](/docs/teams.html) — Share context with your team
- [FAQ](/docs/faq.html) — Common questions and troubleshooting
