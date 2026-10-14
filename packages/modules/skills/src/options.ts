import type { Fetcher } from './package-store';

export interface SkillsLogger {
  info(obj: object, msg: string): void;
}

/** What the host app gives the Skills module. Nothing else from the host is imported. */
export interface SkillsModuleOptions {
  /** Folder that contains the skills folder (Open Tesseract: the repo root). */
  rootDir: string;
  /** Skills folder, relative to rootDir. Default 'skills'. */
  skillsDir?: string;
  /** Ids of host things (e.g. workflows) that reference a skill whose path starts with this prefix. Default: none. */
  usedBy?: (pathPrefix: string) => string[];
  logger?: SkillsLogger;
  /** How packages are fetched. Default: shallow git clone. */
  fetcher?: Fetcher;
}

export const SKILLS_OPTIONS = Symbol('SKILLS_OPTIONS');
