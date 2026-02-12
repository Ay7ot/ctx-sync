/**
 * Environment variable handler module.
 *
 * Implements encrypt-by-default semantics: all env vars are encrypted
 * unless they appear on an explicit safe-list AND --allow-plain is used.
 * Even safe-listed keys are encrypted if their value looks like a secret
 * (high entropy or matches a known credential pattern).
 *
 * Secrets are NEVER accepted as CLI arguments — only via interactive
 * prompt (hidden input), stdin pipe, or file descriptor.
 *
 * @module core/env-handler
 */

import { DEFAULT_SAFE_LIST } from '@ctx-sync/shared';
import type { EnvVars, EnvVarEntry } from '@ctx-sync/shared';
import { readState, writeState } from './state-manager.js';

/**
 * Determine whether an environment variable should be encrypted.
 *
 * Default: ALWAYS encrypt. Only safe-listed keys may be stored plain,
 * and even then only if the value does not look sensitive.
 *
 * @param key - The env var key name.
 * @param value - The env var value.
 * @param safeList - Override safe-list (defaults to DEFAULT_SAFE_LIST).
 * @returns `true` if the value should be encrypted.
 */
export function shouldEncrypt(
  key: string,
  value: string,
  safeList: readonly string[] = DEFAULT_SAFE_LIST,
): boolean {
  // If not on the safe-list → always encrypt
  if (!safeList.includes(key.toUpperCase())) {
    return true;
  }

  // On the safe-list, but double-check value doesn't look sensitive
  if (hasHighEntropy(value) || containsCredentialPattern(value)) {
    return true;
  }

  return false;
}

/**
 * Calculate Shannon entropy for a string.
 *
 * High-entropy strings (> 4.0 bits/char) are likely API keys, tokens,
 * or other random secrets. Strings shorter than 16 chars are ignored
 * (too short for meaningful entropy measurement).
 *
 * @param value - The string to check.
 * @returns `true` if the string has high entropy (likely a secret).
 */
export function hasHighEntropy(value: string): boolean {
  if (value.length < 16) {
    return false;
  }

  const freq: Record<string, number> = {};
  for (const ch of value) {
    freq[ch] = (freq[ch] ?? 0) + 1;
  }

  const len = value.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy > 4.0;
}

/**
 * Check whether a value matches known credential patterns.
 *
 * Detects common service token prefixes, JWTs, PEM keys, and
 * URLs with embedded credentials.
 *
 * @param value - The string to check.
 * @returns `true` if the value matches a known credential pattern.
 */
export function containsCredentialPattern(value: string): boolean {
  const patterns: RegExp[] = [
    /^sk_/,                                                   // Stripe
    /^ghp_/,                                                  // GitHub PAT
    /^gho_/,                                                  // GitHub OAuth
    /^github_pat_/,                                           // GitHub fine-grained PAT
    /^xoxb-/,                                                 // Slack bot
    /^xoxp-/,                                                 // Slack user
    /^AIza/,                                                  // Google API
    /^AKIA/,                                                  // AWS Access Key
    /^eyJ[A-Za-z0-9_-]+\./,                                  // JWT tokens
    /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----/,                 // PEM private keys
    /-----BEGIN\s+CERTIFICATE-----/,                          // Certificates
    /:\/\/[^:]*:[^@]+@/,                                      // URLs with embedded credentials
    /^SG\./,                                                  // SendGrid
    /^AC[a-f0-9]{32}/,                                        // Twilio
    /^sk-[a-zA-Z0-9]{20,}/,                                  // OpenAI
  ];

  return patterns.some((p) => p.test(value));
}

/** Parsed environment variable from a .env file */
export interface ParsedEnvVar {
  key: string;
  value: string;
}

/**
 * Parse the content of a `.env` file.
 *
 * Handles:
 * - Standard `KEY=value` pairs
 * - Comments (lines starting with `#`)
 * - Empty lines
 * - Quoted values (single and double)
 * - `export` prefix (`export KEY=value`)
 * - Windows line endings (`\r\n`)
 * - Lines with no `=` (ignored)
 * - Lines with `=` but no value (empty string value)
 * - Duplicate keys (last value wins)
 *
 * @param content - The raw content of a `.env` file.
 * @returns Array of parsed key-value pairs.
 */
export function parseEnvFile(content: string): ParsedEnvVar[] {
  const result: ParsedEnvVar[] = [];
  const seen = new Map<string, number>();

  // Normalise line endings
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) {
      continue;
    }

    // Strip optional `export ` prefix
    const stripped = line.startsWith('export ')
      ? line.slice('export '.length).trim()
      : line;

    // Must contain `=`
    const eqIndex = stripped.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }

    const key = stripped.slice(0, eqIndex).trim();
    if (!key) {
      continue; // Skip lines like `=value`
    }

    let value = stripped.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle duplicate keys — last value wins
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      result[existingIndex] = { key, value };
    } else {
      seen.set(key, result.length);
      result.push({ key, value });
    }
  }

  return result;
}

/**
 * Import multiple environment variables for a project.
 *
 * Reads existing env-vars.age (if any), merges in new vars, encrypts
 * and writes back. All vars are encrypted by default — the entire .age
 * file is a single encrypted blob.
 *
 * @param project - The project name.
 * @param vars - Array of key-value pairs to import.
 * @param stateDir - The sync directory path.
 * @param publicKey - The Age public key for encryption.
 * @param privateKey - The Age private key for decryption (to read existing state).
 * @returns The count of imported variables.
 */
export async function importEnvVars(
  project: string,
  vars: ParsedEnvVar[],
  stateDir: string,
  publicKey: string,
  privateKey: string,
): Promise<number> {
  // Read existing env vars
  const existing =
    (await readState<EnvVars>(stateDir, privateKey, 'env-vars')) ?? {};

  // Ensure project bucket exists
  const projectBucket: Record<string, EnvVarEntry> = existing[project] ?? {};
  existing[project] = projectBucket;

  const now = new Date().toISOString();
  for (const { key, value } of vars) {
    projectBucket[key] = {
      value,
      addedAt: now,
    } satisfies EnvVarEntry;
  }

  // Write encrypted state
  await writeState(stateDir, existing, publicKey, 'env-vars');

  return vars.length;
}

/**
 * Add a single environment variable for a project.
 *
 * @param project - The project name.
 * @param key - The variable key.
 * @param value - The variable value (must come from hidden input / stdin, NEVER CLI args).
 * @param stateDir - The sync directory path.
 * @param publicKey - The Age public key.
 * @param privateKey - The Age private key.
 */
export async function addEnvVar(
  project: string,
  key: string,
  value: string,
  stateDir: string,
  publicKey: string,
  privateKey: string,
): Promise<void> {
  await importEnvVars(project, [{ key, value }], stateDir, publicKey, privateKey);
}

/** A listed env var (value optionally hidden) */
export interface ListedEnvVar {
  key: string;
  value: string;
  addedAt: string;
}

/**
 * List environment variables for a project.
 *
 * @param project - The project name.
 * @param stateDir - The sync directory path.
 * @param privateKey - The Age private key for decryption.
 * @param showValues - If `true`, decrypted values are returned; otherwise masked as '********'.
 * @returns Array of env vars (values hidden by default).
 */
export async function listEnvVars(
  project: string,
  stateDir: string,
  privateKey: string,
  showValues: boolean = false,
): Promise<ListedEnvVar[]> {
  const envVars = await readState<EnvVars>(stateDir, privateKey, 'env-vars');

  if (!envVars || !envVars[project]) {
    return [];
  }

  const projectVars = envVars[project] ?? {};
  return Object.entries(projectVars).map(([key, entry]) => ({
    key,
    value: showValues ? entry.value : '********',
    addedAt: entry.addedAt,
  }));
}

/**
 * Validate that a key argument does not contain an embedded value.
 *
 * Rejects `KEY=value` syntax in CLI arguments to prevent secrets
 * from appearing in shell history and process lists.
 *
 * @param keyArg - The key argument from the CLI.
 * @throws If the key contains `=` followed by a value.
 */
export function validateKeyArg(keyArg: string): string {
  if (keyArg.includes('=')) {
    const eqIndex = keyArg.indexOf('=');
    const afterEq = keyArg.slice(eqIndex + 1);
    if (afterEq.length > 0) {
      throw new Error(
        'Cannot pass secret values as CLI arguments.\n' +
          'Secret values are visible in shell history and process lists.\n\n' +
          'Use one of these secure methods instead:\n' +
          `  Interactive:  ctx-sync env add <project> ${keyArg.slice(0, eqIndex)}\n` +
          `  Stdin pipe:   echo "value" | ctx-sync env add <project> ${keyArg.slice(0, eqIndex)} --stdin\n` +
          `  File desc:    ctx-sync env add <project> ${keyArg.slice(0, eqIndex)} --from-fd 3 3< <(pass show key)`,
      );
    }
  }
  return keyArg;
}

/**
 * Read a value from stdin (for piped input).
 *
 * @returns The value read from stdin, trimmed.
 */
export function readValueFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';

    if (process.stdin.isTTY) {
      reject(
        new Error(
          'No data piped to stdin.\n' +
            'Usage: echo "value" | ctx-sync env add <project> <key> --stdin',
        ),
      );
      return;
    }

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    process.stdin.on('error', reject);
  });
}
