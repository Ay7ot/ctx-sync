/**
 * Services handler module.
 *
 * Manages running-service state: dev servers, background processes,
 * and any port-bound services associated with a project. Services are
 * persisted in `services.age` (encrypted) and restored via the command
 * approval workflow — no command is ever auto-executed.
 *
 * @module core/services-handler
 */

import type { Service, ServiceState } from '@ctx-sync/shared';
import { readState, writeState } from './state-manager.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build an empty `ServiceState`.
 */
function emptyState(): ServiceState {
  return { services: [] };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Create a new `Service` entry.
 *
 * @param project   - The project name this service belongs to.
 * @param name      - Human-readable service name (e.g. "api-server").
 * @param port      - Port the service listens on.
 * @param command   - Shell command to start the service.
 * @param autoStart - Whether the service should be suggested on restore.
 * @returns A typed `Service` object.
 */
export function createService(
  project: string,
  name: string,
  port: number,
  command: string,
  autoStart = false,
): Service {
  return { project, name, port, command, autoStart };
}

/**
 * Validate a service entry.
 *
 * Checks:
 *  - name is non-empty
 *  - port is a positive integer in range 1–65535
 *  - command is non-empty
 *
 * @returns An array of human-readable error strings (empty = valid).
 */
export function validateService(service: Service): string[] {
  const errors: string[] = [];

  if (!service.name || service.name.trim().length === 0) {
    errors.push('Service name cannot be empty.');
  }
  if (!service.command || service.command.trim().length === 0) {
    errors.push('Service command cannot be empty.');
  }
  if (
    !Number.isInteger(service.port) ||
    service.port < 1 ||
    service.port > 65535
  ) {
    errors.push(
      `Port must be an integer between 1 and 65535, got ${String(service.port)}.`,
    );
  }

  return errors;
}

/**
 * Load all services from encrypted state.
 *
 * @param syncDir    - The sync directory (e.g. ~/.context-sync).
 * @param privateKey - Age private key for decryption.
 * @returns The decrypted `ServiceState`, or an empty state if the file
 *          does not exist.
 */
export async function loadServices(
  syncDir: string,
  privateKey: string,
): Promise<ServiceState> {
  const state = await readState<ServiceState>(syncDir, privateKey, 'services');
  return state ?? emptyState();
}

/**
 * Load services for a specific project.
 *
 * @param syncDir    - The sync directory.
 * @param privateKey - Age private key.
 * @param project    - Project name to filter by.
 * @returns Array of services belonging to the project (may be empty).
 */
export async function loadProjectServices(
  syncDir: string,
  privateKey: string,
  project: string,
): Promise<Service[]> {
  const state = await loadServices(syncDir, privateKey);
  return state.services.filter((s) => s.project === project);
}

/**
 * Save (overwrite) the entire services state.
 *
 * @param syncDir   - The sync directory.
 * @param state     - The complete `ServiceState` to persist.
 * @param publicKey - Age public key for encryption.
 */
export async function saveServices(
  syncDir: string,
  state: ServiceState,
  publicKey: string,
): Promise<void> {
  await writeState(syncDir, state, publicKey, 'services');
}

/**
 * Add a service to the encrypted state.
 *
 * If a service with the same project + name already exists, it is
 * replaced (upsert semantics).
 *
 * @param syncDir    - The sync directory.
 * @param service    - The service to add/replace.
 * @param publicKey  - Age public key for encryption.
 * @param privateKey - Age private key for decryption (needed to read existing state).
 */
export async function addService(
  syncDir: string,
  service: Service,
  publicKey: string,
  privateKey: string,
): Promise<void> {
  const state = await loadServices(syncDir, privateKey);

  // Remove any existing entry with the same project + name (upsert)
  state.services = state.services.filter(
    (s) => !(s.project === service.project && s.name === service.name),
  );
  state.services.push(service);

  await saveServices(syncDir, state, publicKey);
}

/**
 * Remove a service by project + name.
 *
 * @param syncDir    - The sync directory.
 * @param project    - Project name.
 * @param name       - Service name.
 * @param publicKey  - Age public key for encryption.
 * @param privateKey - Age private key for decryption.
 * @returns `true` if a service was removed, `false` if it was not found.
 */
export async function removeService(
  syncDir: string,
  project: string,
  name: string,
  publicKey: string,
  privateKey: string,
): Promise<boolean> {
  const state = await loadServices(syncDir, privateKey);
  const before = state.services.length;
  state.services = state.services.filter(
    (s) => !(s.project === project && s.name === name),
  );

  if (state.services.length === before) {
    return false;
  }

  await saveServices(syncDir, state, publicKey);
  return true;
}

/**
 * Remove all services for a project.
 *
 * @param syncDir    - The sync directory.
 * @param project    - Project name.
 * @param publicKey  - Age public key for encryption.
 * @param privateKey - Age private key for decryption.
 * @returns Number of services removed.
 */
export async function removeProjectServices(
  syncDir: string,
  project: string,
  publicKey: string,
  privateKey: string,
): Promise<number> {
  const state = await loadServices(syncDir, privateKey);
  const before = state.services.length;
  state.services = state.services.filter((s) => s.project !== project);
  const removed = before - state.services.length;

  if (removed > 0) {
    await saveServices(syncDir, state, publicKey);
  }

  return removed;
}

/**
 * List unique project names that have services.
 *
 * @param syncDir    - The sync directory.
 * @param privateKey - Age private key.
 * @returns Sorted array of project names.
 */
export async function listServiceProjects(
  syncDir: string,
  privateKey: string,
): Promise<string[]> {
  const state = await loadServices(syncDir, privateKey);
  const projects = new Set(state.services.map((s) => s.project));
  return [...projects].sort();
}

/**
 * Get services that are marked as auto-start for a project.
 *
 * These are the services that `ctx-sync restore` or
 * `ctx-sync service start` should suggest starting.
 *
 * @param syncDir    - The sync directory.
 * @param privateKey - Age private key.
 * @param project    - Project name.
 * @returns Services marked with `autoStart: true`.
 */
export async function getAutoStartServices(
  syncDir: string,
  privateKey: string,
  project: string,
): Promise<Service[]> {
  const services = await loadProjectServices(syncDir, privateKey, project);
  return services.filter((s) => s.autoStart);
}
