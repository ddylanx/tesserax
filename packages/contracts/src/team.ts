import { z } from 'zod';
import { containsSecretToken } from './redact';
import { AGENT_EXECUTORS, AI_ENGINES, ROLE_KEY_PATTERN } from './workflow';
import type { ImprovementSink } from './context';

/**
 * Team: departments group roles; a role is a reusable sub agent setup (prompt, engine, model, skills, tools, MCP) that a
 * workflow node picks by key `<department-slug>/<role-slug>`. A node's own fields win over the role's; a run's override wins
 * over both. Roles never carry permission modes, env, CLI args or binaries.
 */

/** The only tools a role may allow (a node can narrow them further, never widen them). */
export const ROLE_TOOL_ALLOWLIST = [
  'Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Write',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
] as const;
export type RoleTool = (typeof ROLE_TOOL_ALLOWLIST)[number];

export const ROLE_LIMITS = { maxBudgetUsd: 20, timeoutSeconds: 7200, prompt: 20_000, skills: 20, tools: 50, mcpServers: 20, mission: 300, briefItems: 10, briefItem: 200, contextPacks: 50 } as const;

export const teamSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and -, at most 40');
export const roleKeySchema = z.string().regex(ROLE_KEY_PATTERN, 'a role key like engineering/backend-dev');
export const roleKey = (departmentSlug: string, roleSlug: string) => `${departmentSlug}/${roleSlug}`;

/** Things that look like credentials. Roles are stored in the database and shown in the UI, so they must never hold one. */
export function containsSecret(text: string): boolean {
  return containsSecretToken(text);
}
/** Every string anywhere inside a value (for the secret check on a role's config). */
function strings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
}
const noSecret = (label: string) => (v: unknown, ctx: z.RefinementCtx) => {
  if (strings(v).some(containsSecret)) ctx.addIssue({ code: 'custom', message: `${label} looks like it contains a token or key; never put secrets in a role` });
};

const nameList = (max: number) => z.array(z.string().min(1).max(200)).max(max);
const briefList = z.array(z.string().trim().min(1).max(ROLE_LIMITS.briefItem)).max(ROLE_LIMITS.briefItems).optional();

export const REPORT_LANGUAGES = ['en', 'vi'] as const;
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

export const roleConfigSchema = z
  .object({
    engine: z.enum(AI_ENGINES).optional(),
    model: z.string().trim().min(1).max(100).regex(/^(?!-)[\w.:\[\]\/-]+$/, 'a model id such as sonnet').optional(),
    /** Only used by agent.run nodes. */
    executor: z.enum(AGENT_EXECUTORS).optional(),
    skills: nameList(ROLE_LIMITS.skills).default([]),
    allowedTools: z.array(z.enum(ROLE_TOOL_ALLOWLIST)).max(ROLE_LIMITS.tools).optional(),
    /** Asked of the MCP policy (System page); the policy still decides what is granted. */
    mcp: z.object({ servers: nameList(ROLE_LIMITS.mcpServers).optional(), tools: nameList(ROLE_LIMITS.tools).optional() }).strict().optional(),
    maxBudgetUsd: z.number().positive().max(ROLE_LIMITS.maxBudgetUsd).optional(),
    timeoutSeconds: z.number().int().positive().max(ROLE_LIMITS.timeoutSeconds).optional(),
    /** What the role is for, in one or two sentences (shown on the Team page, told to the agent). */
    mission: z.string().trim().max(ROLE_LIMITS.mission).optional(),
    whenToUse: briefList,
    notFor: briefList,
    /** What the step must be given to do the work well (documents, access, decisions). */
    inputsNeeded: briefList,
    /** Language of the step's report (its headings and text). */
    reportLanguage: z.enum(REPORT_LANGUAGES).default('en'),
    /** Slugs of the context packs switched on for this role (Context page). Packs pinned to the role are always on and not listed. */
    context: z.array(teamSlugSchema).max(ROLE_LIMITS.contextPacks).optional(),
  })
  .strict()
  .superRefine(noSecret('The config'));
export type RoleConfig = z.infer<typeof roleConfigSchema>;

/** The role's descriptor as a short section the agent reads after the role prompt; '' when the role has none. */
export function roleBrief(c: Pick<RoleConfig, 'mission' | 'whenToUse' | 'notFor' | 'inputsNeeded'>): string {
  const list = (title: string, items?: string[]) => (items?.length ? [`${title}:`, ...items.map(i => `- ${i}`)] : []);
  const lines = [
    ...(c.mission ? [`Mission: ${c.mission}`] : []),
    ...list('Use this role for', c.whenToUse),
    ...list('Not for', c.notFor),
    ...list('Inputs you need', c.inputsNeeded),
  ];
  return lines.length ? ['## Your role', ...lines].join('\n') : '';
}

export const rolePromptSchema = z.string().max(ROLE_LIMITS.prompt).superRefine(noSecret('The prompt'));

export const departmentSchema = z.object({
  id: z.string(),
  slug: teamSlugSchema,
  name: z.string(),
  color: z.string(),
  description: z.string(),
  position: z.number(),
});
export type Department = z.infer<typeof departmentSchema>;

export const roleSchema = z.object({
  id: z.string(),
  /** `<department-slug>/<role-slug>`, what a workflow node names. */
  key: z.string(),
  departmentId: z.string(),
  slug: z.string(),
  title: z.string(),
  enabled: z.boolean(),
  prompt: z.string(),
  /** As stored; when the stored config no longer parses, `problems` says why and runs using the role fail. */
  config: z.record(z.string(), z.unknown()),
  position: z.number(),
  /** sha256 of {prompt, config}, first 12 hex chars; stored on each step that used the role. */
  hash: z.string(),
  problems: z.array(z.string()),
  /** Ids of the workflows whose nodes name this role. */
  usedBy: z.array(z.string()),
  /** Text of the context packs the role uses now (Context page). Only RoleLookup.getByKey fills it; lists leave it out. */
  contextText: z.string().optional(),
});
export type Role = z.infer<typeof roleSchema>;

export const saveDepartmentSchema = z.object({
  slug: teamSlugSchema,
  name: z.string().trim().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#64748b'),
  description: z.string().max(2000).default(''),
  position: z.number().int().min(0).max(10_000).optional(),
});
export type SaveDepartment = z.infer<typeof saveDepartmentSchema>;

export const saveRoleSchema = z.object({
  departmentId: z.string().uuid(),
  slug: teamSlugSchema,
  title: z.string().trim().min(1).max(100).superRefine(noSecret('The title')),
  enabled: z.boolean().default(true),
  prompt: rolePromptSchema.default(''),
  config: roleConfigSchema.default({ skills: [], reportLanguage: 'en' }),
  position: z.number().int().min(0).max(10_000).optional(),
});
export type SaveRole = z.infer<typeof saveRoleSchema>;

export const teamListSchema = z.object({ departments: z.array(departmentSchema), roles: z.array(roleSchema) });
export type TeamList = z.infer<typeof teamListSchema>;

export const roleChangeSchema = z.object({
  id: z.string(),
  roleId: z.string().nullable(),
  roleKey: z.string(),
  oldHash: z.string().nullable(),
  newHash: z.string().nullable(),
  action: z.enum(['create', 'update', 'delete']),
  at: z.string(),
});
export type RoleChange = z.infer<typeof roleChangeSchema>;

/** What the workflow engine uses; provided under the token ROLE_LOOKUP (@tesserax/core). */
export interface RoleLookup extends Partial<ImprovementSink> {
  /** null when no role has that key. */
  getByKey(key: string): Promise<Role | null>;
  /** Keys of every role (enabled or not). */
  keys(): Promise<string[]>;
}

/** What the team module asks of the workflow module (bound to the token WORKFLOW_USAGE). */
export interface WorkflowUsage {
  /** Ids of the workflows that name the role key. */
  usedBy(key: string): string[];
}

/** A project lists the roles its runs may use; null = every role. */
export function roleInScope(project: { settings: { roles?: string[] | null } } | null | undefined, key: string): boolean {
  const roles = project?.settings.roles;
  return !roles || roles.includes(key);
}
