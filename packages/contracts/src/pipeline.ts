import { z } from 'zod';
import { taskDetailSchema, taskSchema } from './tasks';

export const PIPELINE_STATES = [
  'new', 'classifying', 'awaiting_decision', 'rejected', 'queued', 'running_playbook',
  'awaiting_verify', 'verified_true', 'verified_false', 'failed', 'cancelled',
] as const;
export const pipelineStateSchema = z.enum(PIPELINE_STATES);
export type PipelineStateDto = z.infer<typeof pipelineStateSchema>;

/** States in which a run still occupies its task (one at a time). */
export const ACTIVE_PIPELINE_STATES: readonly PipelineStateDto[] = [
  'new', 'classifying', 'awaiting_decision', 'queued', 'running_playbook', 'awaiting_verify', 'failed',
];

export const ISSUE_TYPES = ['bug', 'feature', 'chore', 'research', 'question', 'review'] as const;
export const AUTOMATION_LEVELS = ['auto', 'assisted', 'manual'] as const;

/** What the classifier must return (validated; anything else is rejected and falls back to rules). */
export const classificationSchema = z.object({
  type: z.enum(ISSUE_TYPES),
  automation: z.enum(AUTOMATION_LEVELS),
  playbook: z.string().nullable(),
  repo: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(1000),
});
export type Classification = z.infer<typeof classificationSchema>;

export const decisionSchema = z.object({
  type: z.enum(ISSUE_TYPES),
  automation: z.enum(AUTOMATION_LEVELS),
  playbookId: z.string().min(1),
  repoPath: z.string().min(1).optional(),
  note: z.string().max(2000).optional(),
  /** Set by the server: where tx/<KEY> branches from. */
  baseRef: z.string().optional(),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

export const verifySchema = z.object({
  outcome: z.boolean(),
  note: z.string().max(4000).optional(),
});
export type VerifyInput = z.infer<typeof verifySchema>;

export const postCommentSchema = z.object({
  /** The exact text the user confirmed in the dialog. */
  text: z.string().min(1).max(20000),
  confirm: z.literal(true),
});

export const runResultSchema = z.object({
  exitCode: z.number().nullable(),
  isError: z.boolean(),
  subtype: z.string().nullable(),
  summary: z.string().nullable(),
  durationMs: z.number().nullable(),
  costUsd: z.number().nullable(),
  numTurns: z.number().nullable(),
  diff: z
    .object({ files: z.number(), insertions: z.number(), deletions: z.number(), stat: z.string(), untracked: z.array(z.string()) })
    .nullable(),
  commits: z.array(z.string()),
  signal: z.string().nullable(), // quota | budget | max_turns | auth | timeout | ...
});
export type RunResult = z.infer<typeof runResultSchema>;

export const pipelineRunSchema = z.object({
  id: z.string(),
  state: pipelineStateSchema,
  trigger: z.string(),
  attempt: z.number(),
  task: taskSchema,
  classification: classificationSchema.nullable(),
  classificationEngine: z.string().nullable(),
  decision: decisionSchema.nullable(),
  playbookId: z.string().nullable(),
  repoPath: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  agentSessionId: z.string().nullable(),
  result: runResultSchema.nullable(),
  error: z.string().nullable(),
  errorStep: z.string().nullable(),
  verifyNote: z.string().nullable(),
  jiraCommentId: z.string().nullable(),
  createdAt: z.string(),
  stateChangedAt: z.string(),
});
export type PipelineRunDto = z.infer<typeof pipelineRunSchema>;

export const pipelineEventSchema = z.object({
  id: z.string(),
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  actor: z.string(),
  action: z.string(),
  detail: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type PipelineEventDto = z.infer<typeof pipelineEventSchema>;

export const pipelineRunDetailSchema = pipelineRunSchema.extend({
  task: taskDetailSchema,
  events: z.array(pipelineEventSchema),
  /** Repo path the project maps to (config/repos.json), if any. */
  mappedRepo: z.string().nullable(),
  /** Branch new issue branches start from (configured, else the repo's origin/HEAD). */
  baseRef: z.string().nullable(),
  agentSession: z
    .object({ status: z.string(), lastEvent: z.string().nullable(), lastEventAt: z.string(), lastTool: z.string().nullable() })
    .nullable(),
});
export type PipelineRunDetail = z.infer<typeof pipelineRunDetailSchema>;

export const pipelineListSchema = z.object({
  runs: z.array(pipelineRunSchema),
  counts: z.record(z.string(), z.number()),
});
export type PipelineList = z.infer<typeof pipelineListSchema>;

export const playbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  appliesTo: z.array(z.enum(ISSUE_TYPES)),
  steps: z.array(z.string()),
  permissionMode: z.string(),
  allowedTools: z.array(z.string()),
  makesChanges: z.boolean(),
});
export type PlaybookDto = z.infer<typeof playbookSchema>;

/** Jira project key -> repo path, or { path, base } where base is the branch new issue branches start from. */
export const repoEntrySchema = z.union([
  z.string().min(1),
  z.object({
    path: z.string().min(1),
    base: z.string().min(1).optional(),
    /** Git remote to push to (default: the base branch's remote, usually origin). */
    remote: z.string().min(1).optional(),
    /** Bitbucket "workspace/repo" when it cannot be read from the remote URL. */
    bitbucket: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional(),
  }),
]);
export const repoMapSchema = z.record(z.string().regex(/^[A-Z][A-Z0-9_]*$/), repoEntrySchema);
export type RepoMap = z.infer<typeof repoMapSchema>;

export const runDiffSchema = z.object({ base: z.string().nullable(), patch: z.string(), truncated: z.boolean() });
export type RunDiff = z.infer<typeof runDiffSchema>;

export const feedbackStatsSchema = z.object({
  total: z.number(),
  verifiedTrue: z.number(),
  classificationAccepted: z.number(),
  byPlaybook: z.array(z.object({ playbookId: z.string().nullable(), total: z.number(), verifiedTrue: z.number() })),
  byEngine: z.array(z.object({ engine: z.string().nullable(), total: z.number(), accepted: z.number() })),
  recent: z.array(
    z.object({ runId: z.string(), taskKey: z.string().nullable(), playbookId: z.string().nullable(), outcome: z.boolean(), note: z.string().nullable(), createdAt: z.string() }),
  ),
});
export type FeedbackStats = z.infer<typeof feedbackStatsSchema>;
