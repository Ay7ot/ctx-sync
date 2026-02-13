# Frequently Asked Questions

## General

### What is ctx-sync?

ctx-sync is a CLI tool that syncs your complete development context across multiple machines using Git as the backend. It tracks your projects, environment variables, Docker services, mental context, and more — all encrypted with Age encryption.

### Why do I need this?

Research shows developers lose 23 minutes regaining flow state after interruptions. When switching between machines, you lose:

- Active project state (repos, branches)
- Environment variables
- Running services (Docker, dev servers)
- Mental context (what were you working on?)

ctx-sync preserves and restores all of this in seconds.

### Do I need a server?

No. ctx-sync uses Git as the backend. You just need a private Git repository (GitHub, GitLab, Bitbucket, or self-hosted).

### Is it free?

Yes. ctx-sync is free and open-source under the MIT license.

## Security

### Is my data safe?

Yes. All state files are encrypted with Age encryption before being committed to Git. Even project names and paths are encrypted. An attacker with full read access to your Git repo sees only ciphertext.

### What encryption does ctx-sync use?

ctx-sync uses [Age encryption](https://age-encryption.org/), a modern, audited encryption tool. It uses X25519 key agreement and ChaCha20-Poly1305 for symmetric encryption.

### What if I lose my private key?

If you lose your private key, your encrypted data cannot be recovered. This is by design — there is no backdoor. Always back up your private key to a password manager.

### Can I rotate my key?

Yes. Run `ctx-sync key rotate` to generate a new key pair and re-encrypt all state files. Git history is rewritten to remove old encrypted blobs.

### Are my secrets safe in CLI arguments?

ctx-sync never accepts secret values as CLI arguments. Values are entered via hidden interactive prompt, stdin pipe, or file descriptor. This prevents exposure in shell history and process lists.

## Usage

### How do I track a project?

Navigate to your project directory and run:

```bash
cd ~/projects/my-app
ctx-sync track
```

ctx-sync will auto-detect Git state, .env files, and Docker services.

### How do I restore on a new machine?

```bash
npm install -g ctx-sync
ctx-sync init --restore
# Paste your private key
ctx-sync restore my-app
```

### How do I add environment variables?

Import from a .env file:

```bash
ctx-sync env import .env
```

Or add individually (value entered via hidden prompt):

```bash
ctx-sync env add STRIPE_KEY
```

### How do I sync between machines?

```bash
ctx-sync sync
```

This pushes local changes and pulls remote updates.

### Can I use this with Docker?

Yes. ctx-sync tracks Docker Compose services and can restore them on a new machine. All Docker commands require explicit confirmation before execution.

## Troubleshooting

### "Insecure Git remote" error

ctx-sync requires SSH or HTTPS for Git remotes. HTTP, Git protocol, and FTP are blocked for security.

Fix: Change your remote to use SSH or HTTPS:

```bash
git remote set-url origin git@github.com:user/repo.git
```

### "Key file has insecure permissions" error

Your key file must have permissions set to 600 (owner read/write only).

Fix:

```bash
chmod 600 ~/.config/ctx-sync/key.txt
```

### "Decryption failed" error

This usually means you are using the wrong private key, or the encrypted file is corrupted.

- Verify you are using the correct key: `ctx-sync key show`
- If the file is corrupted, try pulling a fresh copy: `ctx-sync pull`

### ctx-sync is slow

Check your Git repository size with `ctx-sync audit`. If the repo is large, consider running `ctx-sync key rotate` which rewrites history and prunes old blobs.

### Docker services won't start

ctx-sync shows Docker commands for approval but does not manage Docker itself. Make sure Docker is installed and running on your machine.

## Comparison

### ctx-sync vs Atuin

Atuin syncs shell history. ctx-sync syncs your complete development context — projects, environment variables, Docker services, mental context, and more.

### ctx-sync vs dotfiles managers

Dotfiles managers sync configuration files. ctx-sync syncs state — what you are actively working on, not just how your tools are configured.

### ctx-sync vs cloud IDEs

Cloud IDEs solve the multi-machine problem by moving everything to the cloud. ctx-sync keeps you working locally with your preferred tools, editor, and workflow — with no vendor lock-in.
