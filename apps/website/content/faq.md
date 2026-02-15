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

No. ctx-sync uses Git as the backend. You just need to create a dedicated private Git repository (GitHub, GitLab, Bitbucket, or self-hosted) to store your encrypted context. This is a one-time setup — one repo holds all your projects.

:::info No Cloud Required
ctx-sync works completely offline for local operations. You only need network access when syncing to your Git remote.
:::

### Is the sync repo the same as my project repo?

No. ctx-sync uses its own dedicated repository at `~/.context-sync/` to store encrypted snapshots of **all** your projects in one place. Your project repos (the code you work on) are tracked but never modified by ctx-sync. When you run `ctx-sync init`, the remote URL you provide should point to a dedicated private repo you created for ctx-sync — not one of your project repos.

### Can I skip the Git remote?

Yes. ctx-sync works locally without a remote. If you press Enter when prompted for a remote URL during `ctx-sync init`, everything will work — your context is saved to `~/.context-sync/` on your machine. You just won't be able to sync across machines until you add a remote. To add one later, run:

```bash
ctx-sync init --remote <url>
```

### Is it free?

Yes. ctx-sync is free and open-source under the MIT license.

## Security

### Is my data safe?

Yes. All state files are encrypted with Age encryption before being committed to Git. Even project names and paths are encrypted. An attacker with full read access to your Git repo sees only ciphertext.

### What encryption does ctx-sync use?

ctx-sync uses [Age encryption](https://age-encryption.org/), a modern, audited encryption tool. It uses X25519 key agreement and ChaCha20-Poly1305 for symmetric encryption.

### What if I lose my private key?

:::danger No Recovery Without Key
If you lose your private key, your encrypted data cannot be recovered. This is by design — there is no backdoor. Always back up your private key to a password manager.
:::

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

### I ran `init` again and lost my key — what happened?

Starting in v1.2.0, `ctx-sync init` uses **smart init**: if a key already exists on your machine, it reuses it and only updates the remote configuration. Your key is never silently overwritten. If you explicitly need a new key pair, pass `--force`:

```bash
ctx-sync init --force
```

### Does restore use the latest data from the remote?

Yes. Starting in v1.2.0, `ctx-sync restore` automatically pulls the latest state from the remote before decrypting. If you are offline or prefer to use local state, pass `--no-pull`:

```bash
ctx-sync restore my-app --no-pull
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

### "Decryption failed" or "no identity matched" error

This usually means the private key on this machine does not match the key used to encrypt your state files. This is common when setting up a second machine.

:::tip Troubleshooting Decryption
1. **Multi-machine setup:** Make sure you used `ctx-sync init --restore` on the new machine and pasted the **same private key** from your first machine. If you ran `ctx-sync init` without `--restore`, a brand-new key was generated that cannot decrypt your existing data.
2. **Verify your key:** Run `ctx-sync key show` and compare the public key against the one on your other machine.
3. **Pull a fresh copy:** If the file may be corrupted, try `ctx-sync pull` to fetch the latest from the remote.
4. **After key rotation:** If you rotated keys on another machine, run `ctx-sync key update` to sync the new key.
:::

### Git authentication errors or hanging

If ctx-sync shows an error about "terminal prompts disabled" or "authentication failed", it means Git cannot authenticate with your remote.

:::tip Fixing Git Authentication
ctx-sync disables interactive Git credential prompts to prevent the CLI from hanging indefinitely. To fix:
1. **GitHub:** Run `gh auth login` or set up an SSH key with `ssh-keygen -t ed25519`
2. **GitLab/Other:** Configure SSH keys or a credential manager
3. **HTTPS users:** Set up `git credential-manager` or a personal access token
4. **Verify manually:** Try `git ls-remote <your-remote-url>` — if that fails, ctx-sync will too.
:::

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
