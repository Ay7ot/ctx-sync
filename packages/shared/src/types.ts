/**
 * Shared TypeScript type definitions for ctx-sync state files.
 *
 * These interfaces describe the **decrypted in-memory** representation
 * of each state file. On disk and in Git, all state is encrypted as .age blobs.
 */

/** A tracked project */
export interface Project {
  id: string;
  name: string;
  path: string;
  git: {
    branch: string;
    remote: string;
    hasUncommitted: boolean;
    stashCount: number;
  };
  lastAccessed: string;
}

/** Machine metadata */
export interface MachineInfo {
  id: string;
  hostname: string;
}

/** Decrypted state.age structure */
export interface StateFile {
  machine: MachineInfo;
  projects: Project[];
}

/** A single environment variable */
export interface EnvVarEntry {
  value: string;
  addedAt: string;
}

/** Decrypted env-vars.age structure: project name → key → entry */
export interface EnvVars {
  [projectName: string]: {
    [key: string]: EnvVarEntry;
  };
}

/** Docker service entry */
export interface DockerService {
  name: string;
  container: string;
  image: string;
  port: number;
  volumes?: string[];
  autoStart: boolean;
  healthCheck?: string;
}

/** Decrypted docker-state.age structure */
export interface DockerState {
  [projectName: string]: {
    composeFile: string;
    services: DockerService[];
    networks?: string[];
    lastStarted?: string;
  };
}

/** A blocker entry */
export interface Blocker {
  description: string;
  addedAt: string;
  priority: 'low' | 'medium' | 'high';
}

/** A related link */
export interface RelatedLink {
  title: string;
  url: string;
}

/** A breadcrumb entry */
export interface Breadcrumb {
  note: string;
  timestamp: string;
}

/** Mental context for a project */
export interface ProjectMentalContext {
  currentTask: string;
  lastWorkingOn?: {
    file: string;
    line: number;
    column?: number;
    description: string;
    timestamp: string;
  };
  blockers: Blocker[];
  nextSteps: string[];
  relatedLinks: RelatedLink[];
  breadcrumbs: Breadcrumb[];
}

/** Decrypted mental-context.age structure */
export interface MentalContext {
  [projectName: string]: ProjectMentalContext;
}

/** A running service entry */
export interface Service {
  project: string;
  name: string;
  port: number;
  command: string;
  autoStart: boolean;
}

/** Decrypted services.age structure */
export interface ServiceState {
  services: Service[];
}

/** A recent directory entry */
export interface RecentDirectory {
  path: string;
  frequency: number;
  lastVisit: string;
}

/** Decrypted directories.age structure */
export interface DirectoryState {
  recentDirs: RecentDirectory[];
  pinnedDirs: string[];
}

/** File metadata in manifest */
export interface ManifestFileEntry {
  lastModified: string;
}

/** manifest.json structure (only plaintext file in Git) */
export interface Manifest {
  version: string;
  lastSync: string;
  files: {
    [filename: string]: ManifestFileEntry;
  };
}
