/**
 * `ctx-sync audit` command.
 *
 * Runs a comprehensive security audit:
 *   - Key file permissions (0o600).
 *   - Config directory permissions (0o700).
 *   - Remote transport security (SSH/HTTPS only).
 *   - All state files are .age (no plaintext .json state).
 *   - Git history scan for plaintext secret patterns.
 *   - Repo size report.
 *
 * Reports issues with severity levels: critical, warning, info.
 *
 * @module commands/audit
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { Command } from 'commander';
import { withErrorHandler } from '../utils/errors.js';
import { STATE_FILES } from '@ctx-sync/shared';
import { verifyPermissions } from '../core/key-store.js';
import { validateRemoteUrl } from '../core/transport.js';
import { getConfigDir, getSyncDir } from './init.js';

// ─── Interfaces ───────────────────────────────────────────────────────────

/** Severity level for audit findings */
export type AuditSeverity = 'critical' | 'warning' | 'info';

/** A single audit finding */
export interface AuditFinding {
  severity: AuditSeverity;
  check: string;
  message: string;
}

/** Result of the full audit */
export interface AuditResult {
  findings: AuditFinding[];
  passed: boolean;
  repoSizeBytes: number | null;
  repoSizeHuman: string | null;
  stateFileCount: number;
  hasRemote: boolean;
}

// ─── Audit Checks ─────────────────────────────────────────────────────────

/** Secret patterns to scan for in Git history */
const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sk_live_[a-zA-Z0-9]+/, label: 'Stripe live key' },
  { pattern: /sk_test_[a-zA-Z0-9]+/, label: 'Stripe test key' },
  { pattern: /ghp_[a-zA-Z0-9]+/, label: 'GitHub PAT' },
  { pattern: /gho_[a-zA-Z0-9]+/, label: 'GitHub OAuth token' },
  { pattern: /github_pat_[a-zA-Z0-9]+/, label: 'GitHub fine-grained PAT' },
  { pattern: /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/, label: 'Slack bot token' },
  { pattern: /xoxp-[0-9]+-[0-9]+-[a-zA-Z0-9]+/, label: 'Slack user token' },
  { pattern: /AKIA[A-Z0-9]{16}/, label: 'AWS access key' },
  { pattern: /AGE-SECRET-KEY-[A-Z0-9]+/, label: 'Age private key' },
];

/**
 * Check key file and config directory permissions.
 */
export function checkPermissions(configDir: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const result = verifyPermissions(configDir);

  if (result.valid) {
    findings.push({
      severity: 'info',
      check: 'permissions',
      message: 'Key file (600) and config directory (700) permissions are correct.',
    });
  } else {
    for (const issue of result.issues) {
      findings.push({
        severity: 'critical',
        check: 'permissions',
        message: issue,
      });
    }
  }

  return findings;
}

/**
 * Validate remote transport security.
 */
export function checkRemoteTransport(syncDir: string): {
  findings: AuditFinding[];
  hasRemote: boolean;
} {
  const findings: AuditFinding[] = [];
  let hasRemote = false;

  const gitDir = path.join(syncDir, '.git');
  if (!fs.existsSync(gitDir)) {
    findings.push({
      severity: 'warning',
      check: 'transport',
      message: 'No Git repository found in sync directory.',
    });
    return { findings, hasRemote };
  }

  try {
    const remoteOutput = execSync('git remote -v', {
      cwd: syncDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!remoteOutput) {
      findings.push({
        severity: 'info',
        check: 'transport',
        message: 'No remote configured (local-only mode).',
      });
      return { findings, hasRemote };
    }

    hasRemote = true;

    // Parse remote URLs
    const lines = remoteOutput.split('\n');
    const urls = new Set<string>();
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts[1]) {
        urls.add(parts[1]);
      }
    }

    for (const url of urls) {
      try {
        validateRemoteUrl(url);
        findings.push({
          severity: 'info',
          check: 'transport',
          message: `Remote URL is secure: ${url}`,
        });
      } catch (err: unknown) {
        findings.push({
          severity: 'critical',
          check: 'transport',
          message: `Insecure remote: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  } catch {
    findings.push({
      severity: 'warning',
      check: 'transport',
      message: 'Could not check remote URLs (git command failed).',
    });
  }

  return { findings, hasRemote };
}

/**
 * Verify all state files are .age (not .json).
 */
export function checkStateFiles(syncDir: string): {
  findings: AuditFinding[];
  stateFileCount: number;
} {
  const findings: AuditFinding[] = [];

  if (!fs.existsSync(syncDir)) {
    findings.push({
      severity: 'warning',
      check: 'state-files',
      message: 'Sync directory does not exist.',
    });
    return { findings, stateFileCount: 0 };
  }

  const entries = fs.readdirSync(syncDir).filter(
    (e) => !e.startsWith('.') && e !== 'sessions',
  );

  const ageFiles = entries.filter((e) => e.endsWith('.age'));
  const jsonFiles = entries.filter(
    (e) => e.endsWith('.json') && e !== STATE_FILES.MANIFEST,
  );

  if (jsonFiles.length > 0) {
    for (const file of jsonFiles) {
      findings.push({
        severity: 'critical',
        check: 'state-files',
        message: `Plaintext state file found: ${file}. State files must be encrypted as .age files.`,
      });
    }
  }

  if (ageFiles.length > 0) {
    findings.push({
      severity: 'info',
      check: 'state-files',
      message: `${String(ageFiles.length)} encrypted state file(s) found.`,
    });
  }

  // Check manifest is present and minimal
  const manifestPath = path.join(syncDir, STATE_FILES.MANIFEST);
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      const allowedKeys = ['version', 'lastSync', 'files'];
      const extraKeys = Object.keys(manifest).filter(
        (k) => !allowedKeys.includes(k),
      );
      if (extraKeys.length > 0) {
        findings.push({
          severity: 'warning',
          check: 'state-files',
          message: `Manifest contains unexpected keys: ${extraKeys.join(', ')}`,
        });
      } else {
        findings.push({
          severity: 'info',
          check: 'state-files',
          message: 'Manifest contains only version and timestamps (correct).',
        });
      }
    } catch {
      findings.push({
        severity: 'warning',
        check: 'state-files',
        message: 'Could not parse manifest.json.',
      });
    }
  }

  return { findings, stateFileCount: ageFiles.length };
}

/**
 * Scan Git history for plaintext secret patterns.
 */
export function checkGitHistory(syncDir: string): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const gitDir = path.join(syncDir, '.git');

  if (!fs.existsSync(gitDir)) {
    return findings; // No git repo, nothing to scan
  }

  try {
    const history = execSync('git log -p --all --full-history', {
      cwd: syncDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    let foundSecrets = false;
    for (const { pattern, label } of SECRET_PATTERNS) {
      if (pattern.test(history)) {
        foundSecrets = true;
        findings.push({
          severity: 'critical',
          check: 'git-history',
          message: `Potential ${label} found in Git history. Run \`key rotate\` to re-encrypt and rewrite history.`,
        });
      }
    }

    if (!foundSecrets) {
      findings.push({
        severity: 'info',
        check: 'git-history',
        message: 'No plaintext secret patterns found in Git history.',
      });
    }
  } catch {
    // May fail if there's no commit history yet
    findings.push({
      severity: 'info',
      check: 'git-history',
      message: 'No Git history to scan (no commits yet).',
    });
  }

  return findings;
}

/**
 * Report repository size.
 */
export function checkRepoSize(syncDir: string): {
  findings: AuditFinding[];
  sizeBytes: number | null;
  sizeHuman: string | null;
} {
  const findings: AuditFinding[] = [];

  if (!fs.existsSync(syncDir)) {
    return { findings, sizeBytes: null, sizeHuman: null };
  }

  try {
    // Calculate total size recursively
    const sizeBytes = getDirectorySize(syncDir);
    const sizeHuman = formatBytes(sizeBytes);

    findings.push({
      severity: sizeBytes > 100 * 1024 * 1024 ? 'warning' : 'info',
      check: 'repo-size',
      message: `Repository size: ${sizeHuman}${sizeBytes > 100 * 1024 * 1024 ? ' (consider cleanup)' : ''}`,
    });

    return { findings, sizeBytes, sizeHuman };
  } catch {
    return { findings, sizeBytes: null, sizeHuman: null };
  }
}

/**
 * Calculate directory size recursively.
 */
function getDirectorySize(dirPath: string): number {
  let totalSize = 0;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      totalSize += getDirectorySize(fullPath);
    } else if (entry.isFile()) {
      totalSize += fs.statSync(fullPath).size;
    }
  }

  return totalSize;
}

/**
 * Format bytes into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i] ?? 'TB'}`;
}

/**
 * Execute the full audit.
 */
export function executeAudit(): AuditResult {
  const configDir = getConfigDir();
  const syncDir = getSyncDir();

  const allFindings: AuditFinding[] = [];

  // 1. Permissions check
  allFindings.push(...checkPermissions(configDir));

  // 2. Remote transport check
  const transport = checkRemoteTransport(syncDir);
  allFindings.push(...transport.findings);

  // 3. State files check
  const stateFiles = checkStateFiles(syncDir);
  allFindings.push(...stateFiles.findings);

  // 4. Git history scan
  allFindings.push(...checkGitHistory(syncDir));

  // 5. Repo size
  const repoSize = checkRepoSize(syncDir);
  allFindings.push(...repoSize.findings);

  const hasCritical = allFindings.some((f) => f.severity === 'critical');

  return {
    findings: allFindings,
    passed: !hasCritical,
    repoSizeBytes: repoSize.sizeBytes,
    repoSizeHuman: repoSize.sizeHuman,
    stateFileCount: stateFiles.stateFileCount,
    hasRemote: transport.hasRemote,
  };
}

// ─── Commander Registration ───────────────────────────────────────────────

/**
 * Register the `ctx-sync audit` command on the given program.
 */
export function registerAuditCommand(program: Command): void {
  program
    .command('audit')
    .description('Run a comprehensive security audit')
    .action(withErrorHandler(async () => {
      const result = executeAudit();

      const critical = result.findings.filter(
        (f) => f.severity === 'critical',
      );
      const warnings = result.findings.filter(
        (f) => f.severity === 'warning',
      );
      const info = result.findings.filter((f) => f.severity === 'info');

      console.log('\n🔒 ctx-sync Security Audit\n');

      if (critical.length > 0) {
        console.log('❌ Critical Issues:');
        for (const f of critical) {
          console.log(`  [${f.check}] ${f.message}`);
        }
        console.log('');
      }

      if (warnings.length > 0) {
        console.log('⚠ Warnings:');
        for (const f of warnings) {
          console.log(`  [${f.check}] ${f.message}`);
        }
        console.log('');
      }

      if (info.length > 0) {
        console.log('ℹ Info:');
        for (const f of info) {
          console.log(`  [${f.check}] ${f.message}`);
        }
        console.log('');
      }

      if (result.repoSizeHuman) {
        console.log(`📦 Repository size: ${result.repoSizeHuman}`);
      }
      console.log(
        `📄 Encrypted state files: ${String(result.stateFileCount)}`,
      );
      console.log('');

      if (result.passed) {
        console.log('✅ Audit passed — no critical issues found.');
      } else {
        console.log(
          '❌ Audit failed — critical issues require attention.',
        );
        process.exit(1);
      }
    }));
}
