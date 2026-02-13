/**
 * @ctx-sync/shared — Shared constants, types, and utilities.
 *
 * @module @ctx-sync/shared
 */

export { VERSION, DEFAULT_SAFE_LIST, STATE_FILES, CONFIG_DIR, SYNC_DIR } from './constants.js';
export type {
  Project,
  MachineInfo,
  StateFile,
  EnvVarEntry,
  EnvVars,
  DockerService,
  DockerState,
  Blocker,
  RelatedLink,
  Breadcrumb,
  ProjectMentalContext,
  MentalContext,
  Service,
  ServiceState,
  RecentDirectory,
  DirectoryState,
  TeamMember,
  RecipientsConfig,
  UserConfig,
  ManifestFileEntry,
  Manifest,
} from './types.js';
export type { ValidationResult } from './schemas.js';
export {
  validateStateFile,
  validateEnvVars,
  validateManifest,
  validateDockerState,
  validateMentalContext,
  validateServiceState,
  validateDirectoryState,
} from './schemas.js';
