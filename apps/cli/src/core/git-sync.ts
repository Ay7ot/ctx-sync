/**
 * Git sync engine module.
 *
 * Manages the local Git repository used for syncing encrypted state
 * files between machines. Provides operations for init, commit, push,
 * pull, and status queries. All remote operations validate transport
 * security before proceeding.
 *
 * @module core/git-sync
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleGit, type StatusResult } from 'simple-git';
import { validateRemoteUrl } from './transport.js';

/** Result of a getStatus() call */
export interface SyncStatus {
  /** List of changed/untracked files */
  files: string[];
  /** Number of commits ahead of remote */
  ahead: number;
  /** Number of commits behind remote */
  behind: number;
  /** Whether the working tree is clean */
  isClean: boolean;
}

/**
 * Initialise a Git repository in the given directory.
 *
 * If the directory already contains a `.git/` folder, this is a no-op.
 * Otherwise, a new Git repository is created with `git init`.
 *
 * @param dir - The directory to initialise.
 * @returns `true` if a new repo was created, `false` if one already existed.
 */
export async function initRepo(dir: string): Promise<boolean> {
  const gitDir = path.join(dir, '.git');
  if (fs.existsSync(gitDir)) {
    return false;
  }

  // Ensure the directory exists
  fs.mkdirSync(dir, { recursive: true });

  const git = simpleGit(dir);
  await git.init();
  return true;
}

/**
 * Add a remote to the Git repository.
 *
 * Validates the URL using transport security before adding.
 * If a remote with the given name already exists, it is updated.
 *
 * @param dir - The Git repository directory.
 * @param url - The remote URL (SSH or HTTPS).
 * @param remoteName - The name for the remote (default: 'origin').
 * @throws If the URL uses an insecure protocol.
 */
export async function addRemote(
  dir: string,
  url: string,
  remoteName: string = 'origin',
): Promise<void> {
  validateRemoteUrl(url);

  const git = simpleGit(dir);
  const remotes = await git.getRemotes(true);
  const existing = remotes.find((r) => r.name === remoteName);

  if (existing) {
    await git.remote(['set-url', remoteName, url]);
  } else {
    await git.addRemote(remoteName, url);
  }
}

/**
 * Stage files and commit changes to the sync repository.
 *
 * Stages the specified files, then commits with the given message.
 * If there are no changes to commit (working tree is clean after staging),
 * the commit is skipped and `null` is returned.
 *
 * @param dir - The Git repository directory.
 * @param files - List of file paths (relative to dir) to stage.
 * @param message - The commit message.
 * @returns The commit hash, or `null` if no changes were committed.
 */
export async function commitState(
  dir: string,
  files: string[],
  message: string,
): Promise<string | null> {
  const git = simpleGit(dir);

  // Stage specified files
  await git.add(files);

  // Check if there are staged changes
  const status = await git.status();
  const hasStagedChanges =
    status.staged.length > 0 || status.created.length > 0 || status.deleted.length > 0;

  if (!hasStagedChanges) {
    return null; // Nothing to commit
  }

  const result = await git.commit(message);
  return result.commit || null;
}

/**
 * Push the local sync repository to the remote.
 *
 * Validates the remote URL before pushing. If no remote is configured,
 * the push is skipped.
 *
 * @param dir - The Git repository directory.
 * @param remoteName - The remote name (default: 'origin').
 * @param branch - The branch to push (default: 'main').
 * @throws If the remote URL uses an insecure protocol.
 */
export async function pushState(
  dir: string,
  remoteName: string = 'origin',
  branch: string = 'main',
): Promise<void> {
  const git = simpleGit(dir);

  // Verify remote exists and URL is secure
  const remotes = await git.getRemotes(true);
  const remote = remotes.find((r) => r.name === remoteName);

  if (!remote) {
    return; // No remote configured — local only
  }

  validateRemoteUrl(remote.refs.push || remote.refs.fetch);

  await git.push(remoteName, branch, ['--set-upstream']);
}

/**
 * Pull the latest changes from the remote sync repository.
 *
 * Validates the remote URL before pulling. If no remote is configured,
 * the pull is skipped.
 *
 * @param dir - The Git repository directory.
 * @param remoteName - The remote name (default: 'origin').
 * @param branch - The branch to pull (default: 'main').
 * @throws If the remote URL uses an insecure protocol.
 */
export async function pullState(
  dir: string,
  remoteName: string = 'origin',
  branch: string = 'main',
): Promise<void> {
  const git = simpleGit(dir);

  // Verify remote exists and URL is secure
  const remotes = await git.getRemotes(true);
  const remote = remotes.find((r) => r.name === remoteName);

  if (!remote) {
    return; // No remote configured — local only
  }

  validateRemoteUrl(remote.refs.fetch || remote.refs.push);

  await git.pull(remoteName, branch);
}

/**
 * Get the current sync status of the repository.
 *
 * @param dir - The Git repository directory.
 * @returns An object describing changed files, ahead/behind counts, and cleanliness.
 */
export async function getStatus(dir: string): Promise<SyncStatus> {
  const git = simpleGit(dir);
  const status: StatusResult = await git.status();

  return {
    files: status.files.map((f) => f.path),
    ahead: status.ahead,
    behind: status.behind,
    isClean: status.isClean(),
  };
}
