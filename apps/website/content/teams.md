# Team Setup

ctx-sync supports multi-recipient encryption for team collaboration. Share encrypted context with team members using Age's built-in multi-recipient support.

## How It Works

Each team member generates their own key pair. When you add a team member, their public key is added as an Age recipient. State files are then encrypted for all recipients, so any team member can decrypt with their private key.

## Adding a Team Member

### Step 1: Team member generates their key

Each team member runs `ctx-sync init` on their machine:

```bash
ctx-sync init
# Outputs: Public key: age1alice...
```

### Step 2: Exchange public keys out-of-band

Share public keys through a secure channel (in person, encrypted message, etc.). **Never share private keys.**

### Step 3: Add the team member

```bash
ctx-sync team add --name "Alice" --key age1alice...
```

ctx-sync will display a fingerprint for verification:

```
⚠️  Verify this key fingerprint with Alice:
   Fingerprint: A3:F2:9C:...
   Confirm? [y/N]
```

### Step 4: Sync

```bash
ctx-sync sync
```

State files are now encrypted for all team recipients.

## Listing Team Members

```bash
ctx-sync team list
```

Shows all team members and their public keys.

## Removing a Team Member

When a team member leaves or needs to be removed:

```bash
ctx-sync team remove alice
```

This:
1. Removes their public key from the recipient list
2. Re-encrypts all shared state without their key
3. Commits and syncs the changes

The removed member can no longer decrypt any state — including previously encrypted data.

## Key Revocation

For immediate key revocation (e.g., suspected compromise):

```bash
ctx-sync team revoke age1bob...
```

This is functionally similar to `team remove` but operates on the public key directly and triggers immediate re-encryption.

## Security Considerations

- **Verify keys out-of-band** — Always verify public keys through a separate channel to prevent impersonation.
- **Revoke promptly** — When a team member leaves, revoke their key immediately. They retain access to any data they have already decrypted locally, but cannot decrypt new or re-encrypted state.
- **Per-project control** — You can control which team members have access to which projects (not all members see all projects).
- **Audit log** — ctx-sync maintains an audit log of key additions and removals.

## Workflow Example

```bash
# Alice sets up
ctx-sync init
# Public key: age1alice...

# Bob sets up
ctx-sync init
# Public key: age1bob...

# Alice adds Bob
ctx-sync team add --name "Bob" --key age1bob...

# Alice syncs — now encrypted for both
ctx-sync sync

# Bob pulls — can decrypt with his key
ctx-sync pull

# Later: Bob leaves the team
ctx-sync team revoke age1bob...
# All state re-encrypted without Bob's key
```
