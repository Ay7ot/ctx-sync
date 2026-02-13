/**
 * Command validator module.
 *
 * Validates shell commands for suspicious patterns before execution.
 * Used by the `restore` command to prevent remote code execution (RCE)
 * via a compromised Git repo injecting malicious commands into the
 * encrypted state.
 *
 * **Critical security property:** No command is ever executed without
 * explicit user confirmation. There is no `--yes` or `--no-confirm`
 * flag — command confirmation cannot be bypassed.
 *
 * @module core/command-validator
 */

/** Result of command validation */
export interface ValidationResult {
  /** Whether the command matches a suspicious pattern */
  suspicious: boolean;
  /** Human-readable reason why the command is suspicious (empty if safe) */
  reason: string;
}

/** A command pending approval, with metadata for display */
export interface PendingCommand {
  /** The shell command string */
  command: string;
  /** Display label for the command category (e.g. "Docker service", "Auto-start service") */
  label: string;
  /** Optional working directory */
  cwd?: string;
  /** Optional port */
  port?: number;
  /** Optional Docker image name */
  image?: string;
}

/** Result of presenting commands for approval */
export interface ApprovalResult {
  /** Commands that were approved */
  approved: PendingCommand[];
  /** Commands that were rejected */
  rejected: PendingCommand[];
  /** Whether all commands were skipped (non-interactive mode) */
  skippedAll: boolean;
}

/**
 * Suspicious command patterns — each entry is a regex and a description
 * of the threat it detects.
 */
const SUSPICIOUS_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|ksh|dash|csh)\b/i,
    reason: 'Pipes remote content to a shell — potential remote code execution.',
  },
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force|-[a-zA-Z]*f[a-zA-Z]*r)\b/i,
    reason: 'Recursive force-delete — destructive operation.',
  },
  {
    pattern: /\brm\s+-rf\s+\/\s*$/i,
    reason: 'Attempts to delete root filesystem — catastrophic operation.',
  },
  {
    pattern: /\bnc\b.*-[a-zA-Z]*e\b/i,
    reason: 'Netcat with execute flag — potential reverse shell.',
  },
  {
    pattern: /\bpython[23]?\s+-c\b/i,
    reason: 'Inline Python execution — potential arbitrary code execution.',
  },
  {
    pattern: /\bperl\s+-e\b/i,
    reason: 'Inline Perl execution — potential arbitrary code execution.',
  },
  {
    pattern: /\bruby\s+-e\b/i,
    reason: 'Inline Ruby execution — potential arbitrary code execution.',
  },
  {
    pattern: /\bnode\s+-e\b/i,
    reason: 'Inline Node.js execution — potential arbitrary code execution.',
  },
  {
    pattern: /\$\(.*\)/,
    reason: 'Command substitution — embedded command may execute arbitrary code.',
  },
  {
    pattern: /`[^`]+`/,
    reason: 'Backtick command substitution — embedded command may execute arbitrary code.',
  },
  {
    pattern: /\beval\b/i,
    reason: 'eval — executes arbitrary string as code.',
  },
  {
    pattern: /\bexec\b/i,
    reason: 'exec — replaces the current process with another command.',
  },
  {
    pattern: /\b(bash|sh|zsh)\s+-[a-zA-Z]*c\b/i,
    reason: 'Shell with -c flag — executes inline command string.',
  },
  {
    pattern: /\/dev\/(tcp|udp)\//i,
    reason: 'Bash /dev/tcp or /dev/udp — potential reverse shell.',
  },
  {
    pattern: /\bmkfifo\b/i,
    reason: 'Named pipe creation — often used in reverse shell patterns.',
  },
  {
    pattern: /\bchmod\s+[0-7]*[4-7][0-7]{2}\b/i,
    reason: 'Changing file permissions to world-readable — potential security issue.',
  },
  {
    pattern: /\bchown\b/i,
    reason: 'Changing file ownership — potential privilege escalation.',
  },
  {
    pattern: />\s*\/etc\//i,
    reason: 'Writing to /etc/ — modifying system configuration.',
  },
  {
    pattern: /\bsudo\b/i,
    reason: 'sudo — elevated privilege execution.',
  },
  {
    pattern: /\bsu\s+-?\s*\w/i,
    reason: 'su — switching user context.',
  },
  {
    pattern: /\bcrontab\b/i,
    reason: 'crontab — scheduling persistent tasks.',
  },
  {
    pattern: /&&\s*(curl|wget)\b/i,
    reason: 'Chained remote download — may be part of a multi-stage attack.',
  },
];

/**
 * Validate a shell command for suspicious patterns.
 *
 * Checks the command string against known dangerous patterns. This is a
 * defence-in-depth measure — the primary protection is the mandatory
 * user confirmation before any command executes.
 *
 * @param cmd - The shell command string to validate.
 * @returns Validation result with suspicious flag and reason.
 */
export function validateCommand(cmd: string): ValidationResult {
  if (!cmd || typeof cmd !== 'string' || cmd.trim().length === 0) {
    return { suspicious: false, reason: '' };
  }

  const trimmed = cmd.trim();

  for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { suspicious: true, reason };
    }
  }

  return { suspicious: false, reason: '' };
}

/**
 * Validate a Docker image name for suspicious patterns.
 *
 * Flags images from unofficial registries or suspicious names.
 * Trusted images come from well-known publishers (e.g. `postgres`,
 * `redis`, `node`) without a registry prefix, or from trusted registries
 * like `docker.io`.
 *
 * @param image - The Docker image name (e.g. 'postgres:15', 'evil.com/malware:latest').
 * @returns Validation result with warning flag and reason.
 */
export function validateDockerImage(image: string): ValidationResult {
  if (!image || typeof image !== 'string' || image.trim().length === 0) {
    return { suspicious: false, reason: '' };
  }

  const trimmed = image.trim();

  // Images with a registry prefix that isn't docker.io/library are suspicious
  // Official images: 'postgres:15', 'redis:7-alpine', 'node:20'
  // Suspicious images: 'evil.com/postgres:latest', 'attacker/redis:backdoored'
  const hasSlash = trimmed.includes('/');
  if (hasSlash) {
    // Check if it's from a known official source
    const officialPrefixes = [
      'docker.io/library/',
      'docker.io/',
      'library/',
      'ghcr.io/',
      'gcr.io/',
      'mcr.microsoft.com/',
      'public.ecr.aws/',
    ];

    const isOfficial = officialPrefixes.some((prefix) =>
      trimmed.startsWith(prefix),
    );

    if (!isOfficial) {
      return {
        suspicious: true,
        reason: `Non-official Docker image registry: ${trimmed}. Verify this image is trusted.`,
      };
    }
  }

  return { suspicious: false, reason: '' };
}

/**
 * Format commands for display to the user before execution.
 *
 * Groups commands by category (Docker services, auto-start services)
 * and adds warning indicators for suspicious commands.
 *
 * @param commands - The list of commands pending approval.
 * @returns Formatted string for terminal display.
 */
export function formatCommandsForDisplay(commands: PendingCommand[]): string {
  if (commands.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('┌────────────────────────────────────────────┐');

  // Group by label
  const groups = new Map<string, PendingCommand[]>();
  for (const cmd of commands) {
    const existing = groups.get(cmd.label) ?? [];
    existing.push(cmd);
    groups.set(cmd.label, existing);
  }

  let index = 1;
  for (const [label, groupCommands] of groups) {
    lines.push(`│ ${label}:`);
    for (const cmd of groupCommands) {
      const validation = validateCommand(cmd.command);
      const imageValidation = cmd.image
        ? validateDockerImage(cmd.image)
        : null;

      const prefix = `│   ${index}.`;
      lines.push(`${prefix} ${cmd.command}`);

      if (cmd.image) {
        lines.push(`│      Image: ${cmd.image}`);
      }
      if (cmd.port) {
        lines.push(`│      Port: ${cmd.port}`);
      }
      if (cmd.cwd) {
        lines.push(`│      Working dir: ${cmd.cwd}`);
      }

      if (validation.suspicious) {
        lines.push(`│      ⚠️  WARNING: ${validation.reason}`);
      }
      if (imageValidation?.suspicious) {
        lines.push(`│      ⚠️  WARNING: ${imageValidation.reason}`);
      }

      lines.push('│');
      index++;
    }
  }

  lines.push('│ Review each command carefully!             │');
  lines.push('└────────────────────────────────────────────┘');

  return lines.join('\n');
}

/**
 * Present commands for user approval.
 *
 * In interactive mode, displays commands and prompts the user to approve
 * all, reject all, or select individually.
 *
 * In non-interactive mode, displays commands but does NOT execute any —
 * this is the safe default.
 *
 * **Security:** There is no `--yes` or `--no-confirm` flag. Command
 * confirmation cannot be bypassed programmatically.
 *
 * @param commands - The list of commands to present.
 * @param options - Display options.
 * @param options.interactive - Whether to prompt for approval (false = show only).
 * @param options.promptFn - Optional override for the approval prompt (for testing).
 * @returns The approval result (which commands were approved/rejected).
 */
export async function presentCommandsForApproval(
  commands: PendingCommand[],
  options: {
    interactive?: boolean;
    promptFn?: (commands: PendingCommand[]) => Promise<'all' | 'none' | 'select'>;
    selectFn?: (cmd: PendingCommand, index: number) => Promise<boolean>;
  } = {},
): Promise<ApprovalResult> {
  const result: ApprovalResult = {
    approved: [],
    rejected: [],
    skippedAll: false,
  };

  if (commands.length === 0) {
    return result;
  }

  // Non-interactive mode: show commands but skip execution
  if (!options.interactive) {
    result.skippedAll = true;
    result.rejected = [...commands];
    return result;
  }

  // Interactive mode: prompt for approval
  const promptFn = options.promptFn;
  if (!promptFn) {
    // Default: skip all if no prompt function (safety fallback)
    result.skippedAll = true;
    result.rejected = [...commands];
    return result;
  }

  const choice = await promptFn(commands);

  switch (choice) {
    case 'all':
      result.approved = [...commands];
      break;
    case 'none':
      result.rejected = [...commands];
      break;
    case 'select': {
      const selectFn = options.selectFn;
      if (!selectFn) {
        result.rejected = [...commands];
        break;
      }
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        if (!cmd) continue;
        const approved = await selectFn(cmd, i + 1);
        if (approved) {
          result.approved.push(cmd);
        } else {
          result.rejected.push(cmd);
        }
      }
      break;
    }
  }

  return result;
}
