/**
 * Docker handler module.
 *
 * Detects Docker Compose files, parses their service definitions,
 * queries Docker for running container state, and saves/loads
 * encrypted Docker state.
 *
 * **Graceful degradation:** If Docker is not installed or compose files
 * are missing, the module returns empty/null results rather than throwing.
 *
 * @module core/docker-handler
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import type { DockerService, DockerState } from '@ctx-sync/shared';
import { readState, writeState } from './state-manager.js';

/**
 * Known Docker Compose file names (in priority order).
 */
export const COMPOSE_FILE_NAMES: readonly string[] = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
] as const;

/**
 * Result of Docker Compose file detection.
 */
export interface ComposeDetectResult {
  /** Whether a compose file was found */
  found: boolean;
  /** Absolute path to the compose file (null if not found) */
  filePath: string | null;
  /** Which compose file name was found */
  fileName: string | null;
}

/**
 * A parsed service entry from a Docker Compose file.
 */
export interface ParsedService {
  /** Service name (key in the compose file) */
  name: string;
  /** Docker image */
  image: string;
  /** Container name (if specified) */
  container: string;
  /** Published host port (first mapping, or 0 if not specified) */
  port: number;
  /** Volume mounts */
  volumes: string[];
  /** Health check command (if specified) */
  healthCheck: string | undefined;
}

/**
 * Result of parsing a Docker Compose file.
 */
export interface ComposeParseResult {
  /** Parsed services */
  services: ParsedService[];
  /** Networks defined in the compose file */
  networks: string[];
}

/**
 * A running container as reported by Docker.
 */
export interface RunningContainer {
  /** Container ID */
  id: string;
  /** Container name */
  name: string;
  /** Docker image */
  image: string;
  /** Container status (e.g. "Up 2 hours") */
  status: string;
  /** Published ports (e.g. "0.0.0.0:5432->5432/tcp") */
  ports: string;
}

/**
 * Detect a Docker Compose file in the given project directory.
 *
 * Searches for known compose file names in priority order. Does not
 * throw if none is found — returns `found: false`.
 *
 * @param projectDir - Absolute path to the project directory.
 * @returns Detection result with file path if found.
 */
export function detectDockerCompose(projectDir: string): ComposeDetectResult {
  for (const fileName of COMPOSE_FILE_NAMES) {
    const filePath = path.join(projectDir, fileName);
    if (fs.existsSync(filePath)) {
      return {
        found: true,
        filePath,
        fileName,
      };
    }
  }

  return {
    found: false,
    filePath: null,
    fileName: null,
  };
}

/**
 * Parse a Docker Compose file and extract service definitions.
 *
 * Uses a simple YAML parser (line-based) to extract services, ports,
 * images, volumes, and networks without requiring a full YAML library.
 * This handles common compose file patterns.
 *
 * @param filePath - Absolute path to the compose file.
 * @returns Parsed services and networks.
 * @throws If the file cannot be read.
 */
export function parseComposeFile(filePath: string): ComposeParseResult {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Compose file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return parseComposeContent(content);
}

/**
 * Parse Docker Compose YAML content.
 *
 * Simple line-based parser that handles common compose file patterns.
 * Extracts service name, image, container_name, ports, volumes,
 * healthcheck, and top-level networks.
 *
 * @param content - The raw YAML content.
 * @returns Parsed services and networks.
 */
export function parseComposeContent(content: string): ComposeParseResult {
  const lines = content.split('\n');
  const services: ParsedService[] = [];
  const networks: string[] = [];

  let inServices = false;
  let inNetworks = false;
  let currentService: Partial<ParsedService> | null = null;
  let currentServiceName: string | null = null;
  let inPorts = false;
  let inVolumes = false;
  let inHealthcheck = false;
  let servicesIndent = -1;
  let serviceIndent = -1;

  for (const rawLine of lines) {
    // Skip comments and empty lines
    const commentIdx = rawLine.indexOf('#');
    const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    if (line.trim() === '') continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Top-level section detection
    if (indent === 0) {
      // Flush current service before switching sections
      if (currentService && currentServiceName) {
        services.push(finalizeService(currentServiceName, currentService));
        currentService = null;
        currentServiceName = null;
      }

      inPorts = false;
      inVolumes = false;
      inHealthcheck = false;

      if (trimmed === 'services:' || trimmed.startsWith('services:')) {
        inServices = true;
        inNetworks = false;
        servicesIndent = 0;
        continue;
      } else if (trimmed === 'networks:' || trimmed.startsWith('networks:')) {
        inServices = false;
        inNetworks = true;
        continue;
      } else {
        inServices = false;
        inNetworks = false;
        continue;
      }
    }

    // Parse networks section
    if (inNetworks && indent > 0) {
      // Network names are keys at the first indent level
      if (trimmed.endsWith(':') && !trimmed.includes(' ')) {
        networks.push(trimmed.slice(0, -1));
      }
      continue;
    }

    // Parse services section
    if (inServices) {
      // Detect a new service (one level deeper than 'services:')
      if (
        indent > servicesIndent &&
        (serviceIndent === -1 || indent <= serviceIndent) &&
        trimmed.endsWith(':') &&
        !trimmed.includes(' ')
      ) {
        // Flush previous service
        if (currentService && currentServiceName) {
          services.push(finalizeService(currentServiceName, currentService));
        }

        currentServiceName = trimmed.slice(0, -1);
        currentService = {
          volumes: [],
        };
        serviceIndent = indent;
        inPorts = false;
        inVolumes = false;
        inHealthcheck = false;
        continue;
      }

      if (!currentService) continue;

      // Within a service definition
      if (indent > serviceIndent) {
        // Check if we're ending a list context
        if (!trimmed.startsWith('-') && !trimmed.startsWith('#')) {
          if (inPorts && !trimmed.startsWith('-')) {
            inPorts = false;
          }
          if (inVolumes && !trimmed.startsWith('-')) {
            inVolumes = false;
          }
        }

        // Parse ports list items
        if (inPorts && trimmed.startsWith('-')) {
          const portMapping = trimmed.slice(1).trim().replace(/['"]/g, '');
          const hostPort = parseHostPort(portMapping);
          if (hostPort > 0 && !currentService.port) {
            currentService.port = hostPort;
          }
          continue;
        }

        // Parse volumes list items
        if (inVolumes && trimmed.startsWith('-')) {
          const volume = trimmed.slice(1).trim().replace(/['"]/g, '');
          if (volume) {
            currentService.volumes = currentService.volumes ?? [];
            currentService.volumes.push(volume);
          }
          continue;
        }

        // Parse healthcheck test
        if (inHealthcheck) {
          if (trimmed.startsWith('test:')) {
            const testValue = trimmed.slice(5).trim();
            if (testValue) {
              // Could be inline array: ["CMD", "pg_isready"] or a string
              currentService.healthCheck = parseHealthcheckValue(testValue);
            }
          } else if (trimmed.startsWith('-') && !currentService.healthCheck) {
            // Array form (multi-line): take the command part (skip CMD or CMD-SHELL)
            const item = trimmed.slice(1).trim().replace(/['"]/g, '');
            if (item !== 'CMD' && item !== 'CMD-SHELL') {
              currentService.healthCheck = item;
            }
          }
          // Stay in healthcheck context until we get to a key at the service indent level
          const nextKeyMatch = trimmed.match(/^[a-z_]+:/i);
          if (
            nextKeyMatch &&
            !trimmed.startsWith('test:') &&
            !trimmed.startsWith('interval:') &&
            !trimmed.startsWith('timeout:') &&
            !trimmed.startsWith('retries:') &&
            !trimmed.startsWith('start_period:')
          ) {
            inHealthcheck = false;
          } else {
            continue;
          }
        }

        // Parse key-value pairs
        if (trimmed.startsWith('image:')) {
          currentService.image = cleanYamlValue(trimmed.slice(6));
        } else if (trimmed.startsWith('container_name:')) {
          currentService.container = cleanYamlValue(trimmed.slice(15));
        } else if (trimmed.startsWith('ports:')) {
          inPorts = true;
          // Handle inline ports: ["5432:5432"]
          const inlineValue = trimmed.slice(6).trim();
          if (inlineValue) {
            const ports = parseInlineList(inlineValue);
            for (const portMapping of ports) {
              const hostPort = parseHostPort(portMapping);
              if (hostPort > 0 && !currentService.port) {
                currentService.port = hostPort;
              }
            }
            inPorts = false;
          }
        } else if (trimmed.startsWith('volumes:')) {
          inVolumes = true;
          // Handle inline volumes
          const inlineValue = trimmed.slice(8).trim();
          if (inlineValue) {
            const vols = parseInlineList(inlineValue);
            currentService.volumes = currentService.volumes ?? [];
            currentService.volumes.push(...vols);
            inVolumes = false;
          }
        } else if (trimmed.startsWith('healthcheck:')) {
          inHealthcheck = true;
        }
      }
    }
  }

  // Flush the last service
  if (currentService && currentServiceName) {
    services.push(finalizeService(currentServiceName, currentService));
  }

  return { services, networks };
}

/**
 * Clean a YAML value: strip quotes and whitespace.
 */
function cleanYamlValue(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Parse a healthcheck test value.
 *
 * Handles:
 * - Inline array: `["CMD", "pg_isready"]` → `pg_isready`
 * - Inline array: `["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]` → `curl ...`
 * - Plain string: `curl -f http://localhost/health || exit 1` → as-is
 */
function parseHealthcheckValue(raw: string): string {
  const trimmed = raw.trim();

  // Inline array form: ["CMD", "pg_isready"] or ["CMD-SHELL", "..."]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const items = trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));

    // Filter out CMD / CMD-SHELL and return the rest joined
    const commandParts = items.filter(
      (item) => item !== 'CMD' && item !== 'CMD-SHELL',
    );
    return commandParts.join(' ').trim() || trimmed;
  }

  return cleanYamlValue(trimmed);
}

/**
 * Parse an inline YAML list like ["a", "b"] or [a, b].
 */
function parseInlineList(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return [];
}

/**
 * Parse a host port from a port mapping string.
 *
 * Handles formats like:
 * - "5432:5432"
 * - "5432:5432/tcp"
 * - "0.0.0.0:5432:5432"
 * - "8080:80"
 *
 * Returns the **host** port (left side).
 */
export function parseHostPort(mapping: string): number {
  const clean = mapping.replace(/\/\w+$/, '').trim(); // Remove /tcp, /udp suffix
  const parts = clean.split(':');

  if (parts.length === 0) return 0;

  // "5432:5432" or "8080:80" → host port is parts[0]
  // "0.0.0.0:5432:5432" → host port is parts[1]
  if (parts.length === 3) {
    return parseInt(parts[1] ?? '0', 10) || 0;
  }
  if (parts.length === 2) {
    return parseInt(parts[0] ?? '0', 10) || 0;
  }
  if (parts.length === 1) {
    return parseInt(parts[0] ?? '0', 10) || 0;
  }

  return 0;
}

/**
 * Finalize a partially parsed service into a full ParsedService.
 */
function finalizeService(
  name: string,
  partial: Partial<ParsedService>,
): ParsedService {
  return {
    name,
    image: partial.image ?? '',
    container: partial.container ?? `${name}`,
    port: partial.port ?? 0,
    volumes: partial.volumes ?? [],
    healthCheck: partial.healthCheck,
  };
}

/**
 * Check if Docker is available on this machine.
 *
 * @returns `true` if `docker` CLI is installed and responds to `docker info`.
 */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get running containers for a project directory.
 *
 * Uses `docker compose ps` to query running containers related to
 * the compose file in the given directory.
 *
 * @param projectDir - Absolute path to the project directory.
 * @returns List of running containers, or empty array if Docker is not available.
 */
export function getRunningContainers(projectDir: string): RunningContainer[] {
  if (!isDockerAvailable()) {
    return [];
  }

  const compose = detectDockerCompose(projectDir);
  if (!compose.found) {
    return [];
  }

  try {
    const output = execSync(
      'docker compose ps --format json',
      {
        cwd: projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
      },
    ).toString();

    if (!output.trim()) {
      return [];
    }

    // docker compose ps --format json outputs one JSON object per line
    const containers: RunningContainer[] = [];
    for (const line of output.trim().split('\n')) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      try {
        const entry = JSON.parse(trimmedLine) as Record<string, string>;
        containers.push({
          id: entry['ID'] ?? '',
          name: entry['Name'] ?? '',
          image: entry['Image'] ?? '',
          status: entry['Status'] ?? '',
          ports: entry['Ports'] ?? entry['Publishers'] ?? '',
        });
      } catch {
        // Skip malformed lines
      }
    }

    return containers;
  } catch {
    return [];
  }
}

/**
 * Build a DockerState entry for a project from its compose file.
 *
 * Detects the compose file, parses it, and creates a DockerState entry
 * suitable for encryption and storage.
 *
 * @param projectName - The project name (key in the DockerState map).
 * @param projectDir - Absolute path to the project directory.
 * @param autoStartDefault - Default value for autoStart on each service.
 * @returns The project's Docker state entry, or `null` if no compose file found.
 */
export function buildDockerStateEntry(
  projectName: string,
  projectDir: string,
  autoStartDefault = true,
): DockerState[string] | null {
  const compose = detectDockerCompose(projectDir);
  if (!compose.found || !compose.filePath) {
    return null;
  }

  const parsed = parseComposeFile(compose.filePath);

  const services: DockerService[] = parsed.services.map((svc) => ({
    name: svc.name,
    container: svc.container,
    image: svc.image,
    port: svc.port,
    volumes: svc.volumes.length > 0 ? svc.volumes : undefined,
    autoStart: autoStartDefault,
    healthCheck: svc.healthCheck,
  }));

  return {
    composeFile: compose.filePath,
    services,
    networks: parsed.networks.length > 0 ? parsed.networks : undefined,
    lastStarted: undefined,
  };
}

/**
 * Save Docker state for a project to encrypted storage.
 *
 * Reads existing Docker state, merges the new project entry, and
 * writes the updated state to `docker-state.age`.
 *
 * @param syncDir - The sync directory path.
 * @param projectName - The project name (key in DockerState).
 * @param entry - The Docker state entry for the project.
 * @param publicKey - The Age public key for encryption.
 * @param privateKey - The Age private key for reading existing state.
 */
export async function saveDockerState(
  syncDir: string,
  projectName: string,
  entry: DockerState[string],
  publicKey: string,
  privateKey: string,
): Promise<void> {
  // Read existing state
  const existing = await readState<DockerState>(syncDir, privateKey, 'docker-state');
  const dockerState: DockerState = existing ?? {};

  // Merge the new entry
  dockerState[projectName] = entry;

  // Write encrypted state
  await writeState(syncDir, dockerState, publicKey, 'docker-state');
}

/**
 * Load Docker state for a specific project from encrypted storage.
 *
 * @param syncDir - The sync directory path.
 * @param projectName - The project name.
 * @param privateKey - The Age private key for decryption.
 * @returns The project's Docker state, or `null` if not found.
 */
export async function loadDockerState(
  syncDir: string,
  projectName: string,
  privateKey: string,
): Promise<DockerState[string] | null> {
  const dockerState = await readState<DockerState>(syncDir, privateKey, 'docker-state');
  if (!dockerState) return null;
  return dockerState[projectName] ?? null;
}

/**
 * Load all Docker state from encrypted storage.
 *
 * @param syncDir - The sync directory path.
 * @param privateKey - The Age private key for decryption.
 * @returns Full Docker state, or `null` if no docker-state.age exists.
 */
export async function loadAllDockerState(
  syncDir: string,
  privateKey: string,
): Promise<DockerState | null> {
  return readState<DockerState>(syncDir, privateKey, 'docker-state');
}

/**
 * Remove Docker state for a project from encrypted storage.
 *
 * @param syncDir - The sync directory path.
 * @param projectName - The project name to remove.
 * @param publicKey - The Age public key for re-encryption.
 * @param privateKey - The Age private key for decryption.
 * @returns `true` if the project was found and removed.
 */
export async function removeDockerState(
  syncDir: string,
  projectName: string,
  publicKey: string,
  privateKey: string,
): Promise<boolean> {
  const dockerState = await readState<DockerState>(syncDir, privateKey, 'docker-state');
  if (!dockerState || !(projectName in dockerState)) {
    return false;
  }

  const updated: DockerState = {};
  for (const [key, value] of Object.entries(dockerState)) {
    if (key !== projectName) {
      updated[key] = value;
    }
  }
  await writeState(syncDir, updated, publicKey, 'docker-state');
  return true;
}
