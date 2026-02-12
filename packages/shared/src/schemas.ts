/**
 * JSON schema definitions for ctx-sync state file structures.
 *
 * These schemas provide runtime validation for state data
 * to catch malformed or tampered data before it causes issues.
 * Each schema describes the expected shape of its corresponding
 * decrypted state file.
 *
 * @module schemas
 */

/**
 * Simple schema validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that a value is a non-empty string.
 */
function isNonEmptyString(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
    return false;
  }
  return true;
}

/**
 * Validate that a value is a string (may be empty).
 */
function isString(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
    return false;
  }
  return true;
}

/**
 * Validate that a value is a number.
 */
function isNumber(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    errors.push(`${field} must be a number`);
    return false;
  }
  return true;
}

/**
 * Validate that a value is a boolean.
 */
function isBoolean(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'boolean') {
    errors.push(`${field} must be a boolean`);
    return false;
  }
  return true;
}

/**
 * Validate that a value is an array.
 */
function isArray(value: unknown, field: string, errors: string[]): boolean {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return false;
  }
  return true;
}

/**
 * Validate that a value is a plain object.
 */
function isObject(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`${field} must be an object`);
    return false;
  }
  return true;
}

/**
 * Validate an ISO 8601 date string.
 */
function isISODateString(value: unknown, field: string, errors: string[]): boolean {
  if (typeof value !== 'string') {
    errors.push(`${field} must be a date string`);
    return false;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    errors.push(`${field} must be a valid ISO date string`);
    return false;
  }
  return true;
}

/**
 * Validate a Project object.
 */
function validateProject(project: unknown, prefix: string, errors: string[]): void {
  if (!isObject(project, prefix, errors)) return;
  const p = project as Record<string, unknown>;
  isNonEmptyString(p['id'], `${prefix}.id`, errors);
  isNonEmptyString(p['name'], `${prefix}.name`, errors);
  isNonEmptyString(p['path'], `${prefix}.path`, errors);
  isISODateString(p['lastAccessed'], `${prefix}.lastAccessed`, errors);

  if (isObject(p['git'], `${prefix}.git`, errors)) {
    const git = p['git'] as Record<string, unknown>;
    isString(git['branch'], `${prefix}.git.branch`, errors);
    isString(git['remote'], `${prefix}.git.remote`, errors);
    isBoolean(git['hasUncommitted'], `${prefix}.git.hasUncommitted`, errors);
    isNumber(git['stashCount'], `${prefix}.git.stashCount`, errors);
  }
}

/**
 * Validate a StateFile structure (decrypted state.age).
 */
export function validateStateFile(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data, 'StateFile', errors)) {
    return { valid: false, errors };
  }

  const d = data as Record<string, unknown>;

  // machine
  if (isObject(d['machine'], 'machine', errors)) {
    const machine = d['machine'] as Record<string, unknown>;
    isNonEmptyString(machine['id'], 'machine.id', errors);
    isNonEmptyString(machine['hostname'], 'machine.hostname', errors);
  }

  // projects
  if (isArray(d['projects'], 'projects', errors)) {
    const projects = d['projects'] as unknown[];
    for (let i = 0; i < projects.length; i++) {
      validateProject(projects[i], `projects[${i}]`, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an EnvVars structure (decrypted env-vars.age).
 */
export function validateEnvVars(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data, 'EnvVars', errors)) {
    return { valid: false, errors };
  }

  const d = data as Record<string, unknown>;

  for (const [projectName, vars] of Object.entries(d)) {
    if (!isObject(vars, `EnvVars.${projectName}`, errors)) continue;

    const v = vars as Record<string, unknown>;
    for (const [key, entry] of Object.entries(v)) {
      const prefix = `EnvVars.${projectName}.${key}`;
      if (isObject(entry, prefix, errors)) {
        const e = entry as Record<string, unknown>;
        isString(e['value'], `${prefix}.value`, errors);
        isISODateString(e['addedAt'], `${prefix}.addedAt`, errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a Manifest structure (manifest.json).
 */
export function validateManifest(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data, 'Manifest', errors)) {
    return { valid: false, errors };
  }

  const d = data as Record<string, unknown>;
  isNonEmptyString(d['version'], 'version', errors);
  isISODateString(d['lastSync'], 'lastSync', errors);

  if (isObject(d['files'], 'files', errors)) {
    const files = d['files'] as Record<string, unknown>;
    for (const [filename, entry] of Object.entries(files)) {
      if (isObject(entry, `files.${filename}`, errors)) {
        const e = entry as Record<string, unknown>;
        isISODateString(e['lastModified'], `files.${filename}.lastModified`, errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a DockerState structure (decrypted docker-state.age).
 */
export function validateDockerState(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data, 'DockerState', errors)) {
    return { valid: false, errors };
  }

  const d = data as Record<string, unknown>;
  for (const [projectName, state] of Object.entries(d)) {
    const prefix = `DockerState.${projectName}`;
    if (!isObject(state, prefix, errors)) continue;

    const s = state as Record<string, unknown>;
    isString(s['composeFile'], `${prefix}.composeFile`, errors);

    if (isArray(s['services'], `${prefix}.services`, errors)) {
      const services = s['services'] as unknown[];
      for (let i = 0; i < services.length; i++) {
        const sp = `${prefix}.services[${i}]`;
        if (isObject(services[i], sp, errors)) {
          const svc = services[i] as Record<string, unknown>;
          isNonEmptyString(svc['name'], `${sp}.name`, errors);
          isString(svc['image'], `${sp}.image`, errors);
          isNumber(svc['port'], `${sp}.port`, errors);
          isBoolean(svc['autoStart'], `${sp}.autoStart`, errors);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a MentalContext structure (decrypted mental-context.age).
 */
export function validateMentalContext(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data, 'MentalContext', errors)) {
    return { valid: false, errors };
  }

  const d = data as Record<string, unknown>;
  for (const [projectName, context] of Object.entries(d)) {
    const prefix = `MentalContext.${projectName}`;
    if (!isObject(context, prefix, errors)) continue;

    const c = context as Record<string, unknown>;
    isString(c['currentTask'], `${prefix}.currentTask`, errors);

    if (c['nextSteps'] !== undefined) {
      isArray(c['nextSteps'], `${prefix}.nextSteps`, errors);
    }
    if (c['blockers'] !== undefined) {
      isArray(c['blockers'], `${prefix}.blockers`, errors);
    }
    if (c['relatedLinks'] !== undefined) {
      isArray(c['relatedLinks'], `${prefix}.relatedLinks`, errors);
    }
    if (c['breadcrumbs'] !== undefined) {
      isArray(c['breadcrumbs'], `${prefix}.breadcrumbs`, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a ServiceState structure (decrypted services.age).
 */
export function validateServiceState(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data, 'ServiceState', errors)) {
    return { valid: false, errors };
  }

  const d = data as Record<string, unknown>;

  if (isArray(d['services'], 'services', errors)) {
    const services = d['services'] as unknown[];
    for (let i = 0; i < services.length; i++) {
      const prefix = `services[${i}]`;
      if (isObject(services[i], prefix, errors)) {
        const svc = services[i] as Record<string, unknown>;
        isString(svc['project'], `${prefix}.project`, errors);
        isNonEmptyString(svc['name'], `${prefix}.name`, errors);
        isNumber(svc['port'], `${prefix}.port`, errors);
        isString(svc['command'], `${prefix}.command`, errors);
        isBoolean(svc['autoStart'], `${prefix}.autoStart`, errors);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a DirectoryState structure (decrypted directories.age).
 */
export function validateDirectoryState(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(data, 'DirectoryState', errors)) {
    return { valid: false, errors };
  }

  const d = data as Record<string, unknown>;

  if (isArray(d['recentDirs'], 'recentDirs', errors)) {
    const dirs = d['recentDirs'] as unknown[];
    for (let i = 0; i < dirs.length; i++) {
      const prefix = `recentDirs[${i}]`;
      if (isObject(dirs[i], prefix, errors)) {
        const dir = dirs[i] as Record<string, unknown>;
        isNonEmptyString(dir['path'], `${prefix}.path`, errors);
        isNumber(dir['frequency'], `${prefix}.frequency`, errors);
        isISODateString(dir['lastVisit'], `${prefix}.lastVisit`, errors);
      }
    }
  }

  if (isArray(d['pinnedDirs'], 'pinnedDirs', errors)) {
    const pinned = d['pinnedDirs'] as unknown[];
    for (let i = 0; i < pinned.length; i++) {
      isString(pinned[i], `pinnedDirs[${i}]`, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}
