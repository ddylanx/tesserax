import { z } from 'zod';
import { containsSecretToken } from './redact';
import { roleKeySchema, teamSlugSchema } from './team';

/**
 * Context packs (Context page): named blocks of background knowledge a Team role reads before its task. A pack says which
 * roles may use it (`audience`, null = every role). Inside its audience a pack is either pinned (always on) or switched on
 * per role (`role.config.context`). The text of the packs a role uses is appended to its prompt when a step runs.
 */

export const CONTEXT_LIMITS = { packs: 100, name: 100, description: 500, source: 500, body: 20_000, roleChars: 60_000, audience: 200, lesson: 600, reason: 1000, note: 500, proposalSource: 200, lessonsPerRole: 30, pendingPerRole: 20, perStep: 3, rejectedShown: 5 } as const;

const noSecret = (label: string) => (v: string, ctx: z.RefinementCtx) => {
  if (containsSecretToken(v)) ctx.addIssue({ code: 'custom', message: `${label} looks like it contains a token or key; never put secrets in a context pack` });
};

export const saveContextPackSchema = z.object({
  name: z.string().trim().min(1).max(CONTEXT_LIMITS.name).superRefine(noSecret('The name')),
  /** One line: what the pack holds, shown on the Context page. */
  description: z.string().trim().max(CONTEXT_LIMITS.description).default(''),
  /** Markdown the role reads. */
  body: z.string().max(CONTEXT_LIMITS.body).superRefine(noSecret('The body')),
  /** Where the text comes from (files, documents), so a reader can check it. */
  source: z.string().trim().max(CONTEXT_LIMITS.source).default(''),
  /** Role keys that may use the pack; null = every role. */
  audience: z.array(roleKeySchema).max(CONTEXT_LIMITS.audience).nullable().default(null),
  /** Always on for every role in the audience; such a pack cannot be switched off per role. */
  pinned: z.boolean().default(false),
  position: z.number().int().min(0).max(10_000).optional(),
});
export type SaveContextPack = z.infer<typeof saveContextPackSchema>;

export const contextPackSchema = z.object({
  id: z.string(),
  slug: teamSlugSchema,
  name: z.string(),
  description: z.string(),
  body: z.string(),
  source: z.string(),
  audience: z.array(z.string()).nullable(),
  pinned: z.boolean(),
  position: z.number(),
  /** Length of the body. */
  chars: z.number(),
  updatedAt: z.string(),
});
export type ContextPack = z.infer<typeof contextPackSchema>;

/** How one role stands towards one pack. */
export const CONTEXT_STATES = ['pinned', 'on', 'off', 'blocked'] as const;
export type ContextState = (typeof CONTEXT_STATES)[number];

export const roleContextSchema = z.object({
  roleId: z.string(),
  key: z.string(),
  title: z.string(),
  departmentId: z.string(),
  enabled: z.boolean(),
  /** Approved lessons the role works by, and proposals waiting for the owner. */
  lessons: z.number(),
  pendingProposals: z.number(),
  /** Packs the role reads now, in order: pinned first, then the ones switched on. */
  using: z.array(z.string()),
  /** The pinned ones among `using` (cannot be switched off for this role). */
  pinned: z.array(z.string()),
  /** Packs the role may use but that are switched off. */
  available: z.array(z.string()),
  /** Packs whose audience leaves this role out. */
  blocked: z.array(z.string()),
  /** Slugs switched on for the role that no pack has any more, or that the role may no longer use. */
  stale: z.array(z.string()),
  chars: z.object({ prompt: z.number(), context: z.number(), limit: z.number() }),
  overLimit: z.boolean(),
});
export type RoleContext = z.infer<typeof roleContextSchema>;

export const contextOverviewSchema = z.object({
  limits: z.object({ body: z.number(), roleChars: z.number(), packs: z.number(), lessonsPerRole: z.number() }),
  packs: z.array(contextPackSchema),
  roles: z.array(roleContextSchema),
});
export type ContextOverview = z.infer<typeof contextOverviewSchema>;

/** One role with the exact text a step of that role is sent after its own prompt. */
export const roleContextTextSchema = z.object({ role: roleContextSchema, text: z.string() });
export type RoleContextText = z.infer<typeof roleContextTextSchema>;

export const setRoleContextSchema = z.object({ packs: z.array(teamSlugSchema).max(CONTEXT_LIMITS.packs) }).strict();
export type SetRoleContext = z.infer<typeof setRoleContextSchema>;

type PackLike = Pick<ContextPack, 'slug' | 'audience' | 'pinned'>;

/** May the role use the pack at all? */
export const packAllows = (pack: Pick<ContextPack, 'audience'>, roleKey: string) => !pack.audience || pack.audience.includes(roleKey);

export function contextState(pack: PackLike, roleKey: string, switchedOn: readonly string[]): ContextState {
  if (!packAllows(pack, roleKey)) return 'blocked';
  if (pack.pinned) return 'pinned';
  return switchedOn.includes(pack.slug) ? 'on' : 'off';
}

/** Splits the packs (already in display order) by what they are for one role. */
export function resolveContext<P extends PackLike>(packs: P[], roleKey: string, switchedOn: readonly string[]) {
  const by = (state: ContextState) => packs.filter(p => contextState(p, roleKey, switchedOn) === state);
  const pinned = by('pinned');
  const using = [...pinned, ...by('on')];
  const usable = new Set(packs.filter(p => packAllows(p, roleKey)).map(p => p.slug));
  return { using, pinned, available: by('off'), blocked: by('blocked'), stale: switchedOn.filter(s => !usable.has(s)) };
}

/** The slugs a role has switched on, read from its stored config (which may be older than the schema). */
export function switchedOnPacks(config: unknown): string[] {
  const list = (config as { context?: unknown } | null)?.context;
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * What a role-driven step gets after the role's own prompt: the packs it uses, the lessons the owner approved, and the names
 * of what it was not given (so it says what is missing instead of guessing). '' when there is nothing.
 */
export function contextText(
  using: Pick<ContextPack, 'name' | 'body' | 'source'>[],
  notRead: Pick<ContextPack, 'name' | 'slug'>[],
  lessons: { approved: string[]; rejected: { text: string; note: string }[] } = { approved: [], rejected: [] },
): string {
  const parts = using.map(p => [`## Context: ${p.name}`, p.body.trim(), ...(p.source ? [`Source: ${p.source}`] : [])].join('\n\n'));
  if (notRead.length) parts.push(`Context you were not given: ${notRead.map(p => `${p.name} (\`${p.slug}\`)`).join(', ')}. If the task needs something from there, say so in your report; do not guess.`);
  if (lessons.approved.length) parts.push(['## Lessons for this role (approved by the owner; follow them)', ...lessons.approved.map(l => `- ${oneLine(l)}`)].join('\n'));
  if (lessons.rejected.length) {
    parts.push(['Proposals the owner turned down (do not propose them again):', ...lessons.rejected.map(l => `- ${oneLine(l.text)}${l.note ? ` (owner: ${oneLine(l.note)})` : ''}`)].join('\n'));
  }
  return parts.join('\n\n');
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------- improvements: a role proposes how to do its job better, the owner decides ----------

/** lesson = a rule the role wants to work by from now on; context = it asks for a pack it was not given. */
export const IMPROVEMENT_KINDS = ['lesson', 'context'] as const;
export type ImprovementKind = (typeof IMPROVEMENT_KINDS)[number];
/** proposed -> approved | rejected; approved -> retired (the lesson no longer applies). Only a person decides. */
export const IMPROVEMENT_STATUSES = ['proposed', 'approved', 'rejected', 'retired'] as const;
export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

const lessonText = z.string().trim().min(3).max(CONTEXT_LIMITS.lesson).superRefine(noSecret('The text'));

export const proposeImprovementSchema = z.object({
  kind: z.enum(IMPROVEMENT_KINDS).default('lesson'),
  /** The rule, in one or two sentences (kind lesson) or what is needed from the pack (kind context). */
  text: lessonText,
  /** What happened that led to it (a review comment, a mistake, a gap). */
  reason: z.string().trim().max(CONTEXT_LIMITS.reason).superRefine(noSecret('The reason')).default(''),
  /** kind context: the pack asked for. */
  pack: teamSlugSchema.nullable().default(null),
  /** Where it came from: "run <id> · <node>", "manual", "claude-code"… */
  source: z.string().trim().max(CONTEXT_LIMITS.proposalSource).default('manual'),
}).strict().superRefine((v, ctx) => {
  if (v.kind === 'context' && !v.pack) ctx.addIssue({ code: 'custom', path: ['pack'], message: 'a context request names the pack' });
});
export type ProposeImprovement = z.infer<typeof proposeImprovementSchema>;

export const decideImprovementSchema = z.object({
  decision: z.enum(['approve', 'reject', 'retire']),
  /** Why (shown to the role next time when rejected). */
  note: z.string().trim().max(CONTEXT_LIMITS.note).superRefine(noSecret('The note')).default(''),
  /** approve only: the owner's wording, used in place of the role's. */
  text: lessonText.optional(),
}).strict();
export type DecideImprovement = z.infer<typeof decideImprovementSchema>;

export const improvementSchema = z.object({
  id: z.string(),
  roleId: z.string(),
  roleKey: z.string(),
  kind: z.enum(IMPROVEMENT_KINDS),
  text: z.string(),
  reason: z.string(),
  pack: z.string().nullable(),
  source: z.string(),
  status: z.enum(IMPROVEMENT_STATUSES),
  note: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type Improvement = z.infer<typeof improvementSchema>;

export const improvementListSchema = z.object({ improvements: z.array(improvementSchema) });
export const improvementQuerySchema = z.object({ status: z.enum(IMPROVEMENT_STATUSES).optional(), role: z.string().optional() });

/** Same proposal whatever the case, spacing and end punctuation. */
export const improvementFingerprint = (text: string) => text.normalize('NFC').toLowerCase().replace(/[\s.。!…]+/g, ' ').trim();

/** What a run step may hand in: text, reason and, for a context request, the pack. */
export interface ProposedImprovement {
  kind: ImprovementKind;
  text: string;
  reason: string;
  pack: string | null;
}

/** Takes the proposals a role-driven step ended with; bound to the same token as RoleLookup (optional method). */
export interface ImprovementSink {
  /** Saves what is new for the role (duplicates, also of rejected ones, are dropped); returns how many were kept. */
  proposeImprovements(roleKey: string, items: ProposedImprovement[], source: string): Promise<number>;
}
