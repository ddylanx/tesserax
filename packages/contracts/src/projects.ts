import { z } from 'zod';
import { routingSchema } from './workflow';

/**
 * A project is a separate space: its tasks, workplaces, the workflows and skills it uses, its agent engines and variables.
 * A task joins the first project (by position) whose rules match it; you can also move a task by hand (it then stays pinned).
 * A list that is null means "everything" (the default project starts like that, so nothing is hidden before you configure it).
 */
const slug = z.string().min(1).max(60).regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase letters, digits, . _ -');

export const projectSettingsSchema = z.object({
  /** A task matches when any listed value matches. */
  rules: z
    .object({
      /** Jira keys shown as "Board" in the UI, matched against tasks.project. */
      jiraKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'a Jira project key like DEMO')).max(50).default([]),
      sourceIds: z.array(z.string()).max(50).default([]),
      /** Repository ids from the Repos page (tasks of a GitHub source). */
      repositories: z.array(z.string()).max(50).default([]),
    })
    .default({ jiraKeys: [], sourceIds: [], repositories: [] }),
  /** Workplaces runs of this project may use; the first is the default. Empty = every workplace (as before projects existed). */
  workplaceIds: z.array(z.string()).max(50).default([]),
  workflows: z.array(z.string()).nullable().default(null),
  skills: z.array(z.string()).nullable().default(null),
  /** Which workflow a task of this project starts. */
  routing: routingSchema.default({ default: 'default', rules: [] }),
  engines: z.object({ default: z.string().nullable().default(null), allowed: z.array(z.string()).nullable().default(null) }).default({ default: null, allowed: null }),
  /** Used in workflows as {{project.<name>}} (and $TX_PROJECT_<NAME> in shell steps). */
  vars: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/, 'lowercase letters, digits, _'), z.string().max(2000)).default({}),
  /** Prefix of the keys of tasks created here (C-12). */
  keyPrefix: z.string().regex(/^[A-Z][A-Z0-9]{0,5}$/).optional(),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const projectSchema = z.object({
  id: z.string(),
  slug,
  name: z.string(),
  color: z.string(),
  kind: z.enum(['personal', 'company']),
  position: z.number(),
  isDefault: z.boolean(),
  settings: projectSettingsSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const saveProjectSchema = z.object({
  slug,
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#64748b'),
  kind: z.enum(['personal', 'company']).default('personal'),
  settings: projectSettingsSchema.default(() => projectSettingsSchema.parse({})),
});
export type SaveProject = z.infer<typeof saveProjectSchema>;

export const moveTaskSchema = z.object({ projectId: z.string().uuid().nullable() });

/** What the rules look at. */
export interface TaskFacts {
  /** Jira key of the board (tasks.project). */
  project: string | null;
  sourceId: string;
  repositoryId?: string | null;
}

/** What other modules use; provided under the token PROJECT_DIRECTORY (@tesserax/core). */
export interface ProjectDirectory {
  list(): Promise<Project[]>;
  get(idOrSlug: string): Promise<Project | null>;
  /** Never null: falls back to the default project. */
  resolveForTask(task: TaskFacts): Promise<Project>;
  /** null when the folder belongs to no project. */
  resolveForPath(cwd: string): Promise<Project | null>;
  /** Replaces the routing of one project (the Workflows page edits it). */
  saveRouting(idOrSlug: string, routing: z.infer<typeof routingSchema>): Promise<Project>;
  /** Re-applies the rules to tasks that were not moved by hand (all, or one source); returns how many changed project. */
  reassign(sourceId?: string): Promise<number>;
}

export const projectSummarySchema = z.object({
  inProgress: z.number(),
  waitingForYou: z.number(),
  failedRuns: z.number(),
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectCardSchema = projectSchema.extend({ summary: projectSummarySchema });
export type ProjectCard = z.infer<typeof projectCardSchema>;

/** Keys of tasks created in a project: C-12, P-3, or the project's own prefix. */
export function keyPrefixOf(p: { slug: string; settings: { keyPrefix?: string | undefined } }): string {
  if (p.settings.keyPrefix) return p.settings.keyPrefix;
  if (p.slug === 'company') return 'C';
  if (p.slug === 'personal') return 'P';
  return p.slug.replace(/[^a-z0-9]/g, '').slice(0, 4).toUpperCase().replace(/^[0-9]+/, '') || 'T';
}
