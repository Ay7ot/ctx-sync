/**
 * State manager module.
 *
 * Provides read/write operations for all encrypted state files (.age)
 * and the plaintext manifest. State is always encrypted before writing
 * to disk — no plaintext JSON is ever written (except manifest.json
 * which contains only version and timestamps).
 *
 * @module core/state-manager
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { STATE_FILES, VERSION } from '@ctx-sync/shared';
import type {
  StateFile,
  EnvVars,
  DockerState,
  MentalContext,
  ServiceState,
  DirectoryState,
  Manifest,
} from '@ctx-sync/shared';
import { encryptState, decryptState } from './encryption.js';

/**
 * Union of all encrypted state data types.
 */
export type StateData =
  | StateFile
  | EnvVars
  | DockerState
  | MentalContext
  | ServiceState
  | DirectoryState;

/**
 * Map of state file type to filename constant.
 */
export const STATE_FILE_MAP = {
  state: STATE_FILES.STATE,
  'env-vars': STATE_FILES.ENV_VARS,
  'docker-state': STATE_FILES.DOCKER_STATE,
  'mental-context': STATE_FILES.MENTAL_CONTEXT,
  services: STATE_FILES.SERVICES,
  directories: STATE_FILES.DIRECTORIES,
} as const;

/** Valid state file types */
export type StateFileType = keyof typeof STATE_FILE_MAP;

/**
 * Read and decrypt an encrypted state file.
 *
 * Reads the specified `.age` file from the sync directory, decrypts it
 * using the provided private key, and returns the parsed typed data.
 *
 * @param stateDir - The sync directory path (e.g. ~/.context-sync).
 * @param privateKey - The Age private key for decryption.
 * @param fileType - The type of state file to read.
 * @returns The decrypted and parsed state data, or `null` if the file does not exist.
 * @throws If decryption fails (wrong key, corrupted file, etc.).
 */
export async function readState<T = StateData>(
  stateDir: string,
  privateKey: string,
  fileType: StateFileType,
): Promise<T | null> {
  const filename = STATE_FILE_MAP[fileType];
  const filePath = path.join(stateDir, filename);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const ciphertext = fs.readFileSync(filePath, 'utf-8');

  if (!ciphertext.trim()) {
    return null;
  }

  return decryptState<T>(ciphertext, privateKey);
}

/**
 * Encrypt and write state data to disk.
 *
 * Serialises the data as JSON in memory, encrypts it with Age, and writes
 * the resulting `.age` file. **Never writes plaintext JSON to disk.**
 *
 * Also updates the manifest to record the file's modification time.
 *
 * @param stateDir - The sync directory path.
 * @param data - The state data to encrypt and write.
 * @param publicKey - The Age public key for encryption.
 * @param fileType - The type of state file to write.
 * @throws If the filename ends in `.json` (safety check against plaintext writes).
 */
export async function writeState(
  stateDir: string,
  data: StateData,
  publicKey: string,
  fileType: StateFileType,
): Promise<void> {
  const filename = STATE_FILE_MAP[fileType];

  // Safety check: never write plaintext JSON state files
  if (filename.endsWith('.json')) {
    throw new Error(
      `Cannot write unencrypted state file: ${filename}. ` +
        'State files must be encrypted as .age files.',
    );
  }

  // Ensure the directory exists
  fs.mkdirSync(stateDir, { recursive: true });

  const ciphertext = await encryptState(data, publicKey);
  const filePath = path.join(stateDir, filename);
  fs.writeFileSync(filePath, ciphertext, 'utf-8');

  // Update manifest with new modification timestamp
  updateManifestEntry(stateDir, filename);
}

/**
 * Read the plaintext manifest.json from the sync directory.
 *
 * The manifest contains only version and timestamps — no sensitive data.
 * If the file does not exist, returns `null`.
 *
 * @param stateDir - The sync directory path.
 * @returns The parsed manifest, or `null` if it does not exist.
 */
export function readManifest(stateDir: string): Manifest | null {
  const filePath = path.join(stateDir, STATE_FILES.MANIFEST);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  if (!content.trim()) {
    return null;
  }

  return JSON.parse(content) as Manifest;
}

/**
 * Write the plaintext manifest.json to the sync directory.
 *
 * The manifest is the only plaintext file in the sync repo.
 * It contains only version and timestamps — no sensitive data.
 *
 * @param stateDir - The sync directory path.
 * @param data - The manifest data to write.
 */
export function writeManifest(stateDir: string, data: Manifest): void {
  // Ensure the directory exists
  fs.mkdirSync(stateDir, { recursive: true });

  const filePath = path.join(stateDir, STATE_FILES.MANIFEST);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Update a single entry in the manifest with a new modification timestamp.
 *
 * If the manifest does not exist, a new one is created.
 *
 * @param stateDir - The sync directory path.
 * @param filename - The state file name (e.g. 'state.age').
 */
function updateManifestEntry(stateDir: string, filename: string): void {
  const manifest = readManifest(stateDir) ?? {
    version: VERSION,
    lastSync: new Date().toISOString(),
    files: {},
  };

  manifest.files[filename] = {
    lastModified: new Date().toISOString(),
  };
  manifest.lastSync = new Date().toISOString();

  writeManifest(stateDir, manifest);
}

/**
 * List all encrypted state files present in the sync directory.
 *
 * @param stateDir - The sync directory path.
 * @returns Array of filenames that exist on disk.
 */
export function listStateFiles(stateDir: string): string[] {
  if (!fs.existsSync(stateDir)) {
    return [];
  }

  const entries = fs.readdirSync(stateDir);
  return entries.filter((entry) => entry.endsWith('.age'));
}

/**
 * Check if a specific state file exists in the sync directory.
 *
 * @param stateDir - The sync directory path.
 * @param fileType - The type of state file to check.
 * @returns `true` if the file exists.
 */
export function stateFileExists(stateDir: string, fileType: StateFileType): boolean {
  const filename = STATE_FILE_MAP[fileType];
  return fs.existsSync(path.join(stateDir, filename));
}
