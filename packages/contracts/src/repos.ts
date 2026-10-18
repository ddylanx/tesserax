import { z } from 'zod';

/**
 * Repos registry (config/workplaces.json, gitignored): the repositories this project works on and, for each, the
 * workplaces: local checkouts of that repository, one per brand when the same code serves several brands.
 * A task runs in a workplace: the one picked on the task, else the first whose Jira projects include the task's project.
 */
const slug = z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase letters, digits, . _ -');
const projectKey = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'a Jira project key like COL');

export const repositorySchema = z.object({
  id: slug,
  name: z.string().min(1).max(100),
  /** Git origin URL (what `git remote get-url origin` prints); used to check each workplace is the right repo. */
  origin: z.string().max(500).nullable().default(null),
  /** Branch new work starts from and reviews compare against (default: the remote's HEAD). */
  base: z.string().min(1).max(200).optional(),
  /** Remote to fetch from / push to (default origin). */
  remote: z.string().min(1).max(100).optional(),
  /** Bitbucket "workspace/repo" when it cannot be read from the origin URL. */
  bitbucket: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
});
export type Repository = z.infer<typeof repositorySchema>;

export const workplaceSchema = z.object({
  id: slug,
  repositoryId: slug,
  /** Brand this checkout serves (its own .env, config, data). */
  brand: z.string().min(1).max(100),
  /** Absolute path of the checkout (inside your home folder). */
  path: z.string().min(1).max(1000),
  /** Overrides the repository's base branch for this workplace. */
  base: z.string().min(1).max(200).optional(),
  /** Jira project keys whose tasks default to this workplace. */
  projects: z.array(projectKey).max(50).default([]),
  notes: z.string().max(2000).optional(),
});
export type Workplace = z.infer<typeof workplaceSchema>;

export const repoRegistrySchema = z.object({
  repositories: z.array(repositorySchema).default([]),
  workplaces: z.array(workplaceSchema).default([]),
});
export type RepoRegistry = z.infer<typeof repoRegistrySchema>;

/** What is actually on disk for a workplace. */
export interface WorkplaceStatus {
  exists: boolean;
  isGit: boolean;
  /** Origin URL the checkout really has (null when unreadable). */
  origin: string | null;
  /** Checked-out branch (null when detached or unreadable). */
  branch: string | null;
  /** The checkout's origin is the repository's origin (null when either is unknown). */
  originMatches: boolean | null;
  error: string | null;
}

export interface RepoRegistryView {
  repositories: Repository[];
  workplaces: (Workplace & { status: WorkplaceStatus })[];
  /** Jira project keys seen on tasks, to offer in the editor. */
  projects: string[];
  /** Where the registry is stored. */
  file: string;
}

/** Answer of "inspect a folder": what to prefill when registering it. */
export interface RepoInspection {
  path: string;
  isGit: boolean;
  origin: string | null;
  branch: string | null;
  /** Remote's default branch (origin/HEAD), e.g. develop. */
  defaultBranch: string | null;
  suggestedName: string;
  /** Registered repository with the same origin, if any. */
  repositoryId: string | null;
  /** Stack-detected project variable suggestions (test_command, worktree_links). */
  suggestedVars?: Record<string, string>;
}

/** The workplace a task resolves to (null fields when it came from the legacy config/repos.json). */
export interface ResolvedWorkplace {
  workplaceId: string | null;
  brand: string | null;
  repositoryId: string | null;
  repositoryName: string | null;
  origin: string | null;
  path: string;
  base?: string;
  remote?: string;
  bitbucket?: string;
}

export const setTaskWorkplaceSchema = z.object({ workplaceId: slug.nullable() });
