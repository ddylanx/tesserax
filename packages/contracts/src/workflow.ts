import { z } from 'zod';
import { taskDetailSchema, taskSchema } from './tasks';

// ---------- node types ----------

/**
 * Who does an agent.run step: a CLI agent running in the background, or you in an editor (the worktree is opened
 * there with the prompt ready; you click Done when finished). "ask" lets you choose when the step is reached.
 */
export const AGENT_EXECUTORS = ['claude-cli', 'gemini-cli', 'antigravity-cli', 'editor:antigravity', 'editor:antigravity-ide', 'editor:cursor', 'editor:vscode'] as const;
export type AgentExecutor = (typeof AGENT_EXECUTORS)[number];
export const AGENT_EXECUTOR_INFO: Record<AgentExecutor, { title: string; description: string; kind: 'cli' | 'editor' }> = {
  'claude-cli': { title: 'Claude Code (CLI)', description: 'Runs headless in the worktree, commits locally. Uses your Claude plan.', kind: 'cli' },
  'gemini-cli': { title: 'Gemini CLI', description: 'Runs headless in the worktree (file edits only, no shell). Uses your Google account.', kind: 'cli' },
  'antigravity-cli': { title: 'Antigravity CLI', description: 'Runs headless in the worktree (file edits only, no shell). Uses your Antigravity account and quota.', kind: 'cli' },
  'editor:antigravity': { title: 'Antigravity', description: 'Opens the worktree in Antigravity; you work with its agent, then click Done.', kind: 'editor' },
  'editor:antigravity-ide': { title: 'Antigravity IDE', description: 'Opens the worktree in Antigravity IDE; you work with its agent, then click Done.', kind: 'editor' },
  'editor:cursor': { title: 'Cursor', description: 'Opens the worktree in Cursor; you work with its agent, then click Done.', kind: 'editor' },
  'editor:vscode': { title: 'VS Code', description: 'Opens the worktree in VS Code; you work there, then click Done.', kind: 'editor' },
};

const tools = z.array(z.string()).default(['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)']);
const artifactName = z.string().regex(/^[a-z][a-z0-9_-]*$/, 'lowercase name, e.g. analysis');

export const nodeConfigSchemas = {
  'trigger.jira': z.object({}).default({}),
  'ai.classify': z.object({
    model: z.string().optional(),
    timeoutSeconds: z.number().int().positive().default(180),
  }),
  'ai.step': z.object({
    skill: z.string().optional(),
    prompt: z.string().min(1),
    inputs: z.array(artifactName).default([]),
    output: artifactName,
    allowedTools: tools,
    /** Which CLI does this step: Claude Code (default) or Gemini CLI. */
    engine: z.enum(['claude', 'gemini', 'antigravity']).default('claude'),
    model: z.string().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    timeoutSeconds: z.number().int().positive().default(600),
  }),
  'human.gate': z.object({
    instructions: z.string().default(''),
    show: z.array(artifactName).default([]),
    editable: z.array(artifactName).default([]),
  }),
  'agent.run': z.object({
    executor: z.enum(['ask', ...AGENT_EXECUTORS]).default('ask'),
    skill: z.string().optional(),
    prompt: z.string().min(1),
    inputs: z.array(artifactName).default([]),
    output: artifactName.default('implementation'),
    permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'dontAsk']).default('acceptEdits'),
    allowedTools: z.array(z.string()).default(['Read', 'Grep', 'Glob', 'Edit', 'MultiEdit', 'Write', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git add:*)', 'Bash(git commit:*)']),
    model: z.string().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    timeoutSeconds: z.number().int().positive().default(1800),
  }),
  'check.command': z.object({
    commands: z.array(z.string().min(1)).min(1),
    output: artifactName.default('checks'),
    timeoutSeconds: z.number().int().positive().default(900),
  }),
  'ai.review': z.object({
    skills: z.array(z.string()).default([]),
    prompt: z.string().min(1),
    inputs: z.array(artifactName).default([]),
    output: artifactName.default('review'),
    allowedTools: tools,
    /** Which CLI does this step: Claude Code (default) or Gemini CLI. */
    engine: z.enum(['claude', 'gemini', 'antigravity']).default('claude'),
    model: z.string().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    timeoutSeconds: z.number().int().positive().default(900),
  }),
  'doc.write': z.object({
    skill: z.string().optional(),
    prompt: z.string().min(1),
    inputs: z.array(artifactName).default([]),
    output: artifactName.default('ticket_doc'),
    /** File in the repo, relative to its root. Placeholders: {{issue_key}}, {{slug}}. */
    path: z.string().min(1).default('docs/{{issue_key}}-{{slug}}.md'),
    commitMessage: z.string().min(1).default('{{issue_key}}: add ticket document'),
    allowedTools: tools,
    /** Which CLI does this step: Claude Code (default) or Gemini CLI. */
    engine: z.enum(['claude', 'gemini', 'antigravity']).default('claude'),
    model: z.string().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    timeoutSeconds: z.number().int().positive().default(600),
  }),
  'jira.comment': z.object({
    skill: z.string().optional(),
    prompt: z.string().min(1),
    inputs: z.array(artifactName).default([]),
    output: artifactName.default('jira_comment'),
    allowedTools: tools,
    /** Which CLI does this step: Claude Code (default) or Gemini CLI. */
    engine: z.enum(['claude', 'gemini', 'antigravity']).default('claude'),
    model: z.string().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    timeoutSeconds: z.number().int().positive().default(600),
  }),
  'git.pr': z.object({
    skill: z.string().optional(),
    prompt: z.string().min(1),
    inputs: z.array(artifactName).default([]),
    output: artifactName.default('pr_description'),
    title: z.string().min(1).default('{{issue_key}}: {{issue_title}}'),
    /** Target branch; empty = the run's base branch (e.g. develop). */
    targetBranch: z.string().optional(),
    allowedTools: tools,
    /** Which CLI does this step: Claude Code (default) or Gemini CLI. */
    engine: z.enum(['claude', 'gemini', 'antigravity']).default('claude'),
    model: z.string().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    timeoutSeconds: z.number().int().positive().default(600),
  }),
  'pr.comment': z.object({
    /** The document to post (usually the review you approved at the previous gate). */
    from: artifactName.default('review'),
  }),
  evaluate: z.object({
    criteria: z.array(z.string().min(1)).min(1).default(['Meets the requirement', 'Code quality', 'Tests', 'Documentation']),
  }),
} as const;

export type NodeType = keyof typeof nodeConfigSchemas;
export const NODE_TYPES = Object.keys(nodeConfigSchemas) as NodeType[];

export const NODE_PORTS: Record<NodeType, readonly string[]> = {
  'trigger.jira': ['next'],
  'ai.classify': ['next'],
  'ai.step': ['next'],
  'human.gate': ['approved', 'changes', 'rejected'],
  'agent.run': ['done', 'failed'],
  'check.command': ['pass', 'fail'],
  'ai.review': ['pass', 'fail'],
  'doc.write': ['next'],
  'jira.comment': ['posted', 'skipped'],
  'git.pr': ['opened', 'skipped'],
  'pr.comment': ['posted', 'skipped'],
  evaluate: ['end'],
};

/** Nodes that prepare a draft, then wait for the user's explicit confirmation before writing outside the machine. */
export const CONFIRM_NODE_TYPES: readonly NodeType[] = ['jira.comment', 'git.pr'];

/** Node types that wait for the user instead of running. */
export const HUMAN_NODE_TYPES: readonly NodeType[] = ['human.gate', 'evaluate'];

// ---------- conditions (skip rules, routing) ----------

export const CONDITION_FIELDS = [
  'classification.type', 'classification.automation', 'issue.type', 'issue.project', 'issue.priority', 'issue.status', 'issue.labels', 'issue.components',
] as const;
export const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  op: z.enum(['in', 'not_in']),
  values: z.array(z.string().min(1)).min(1),
});
export type Condition = z.infer<typeof conditionSchema>;

export interface ConditionContext {
  issue: { type?: string | null; project?: string | null; priority?: string | null; status?: string | null; labels?: string[]; components?: string[] };
  classification?: { type?: string; automation?: string } | null;
}

/** All conditions must hold. Case-insensitive; list fields (labels, components) match when any element is in the values. */
export function conditionsMatch(conds: Condition[] | undefined, ctx: ConditionContext): boolean {
  if (!conds?.length) return false;
  return conds.every(c => {
    const [scope, key] = c.field.split('.') as ['issue' | 'classification', string];
    const raw = (scope === 'issue' ? ctx.issue : ctx.classification ?? {}) as Record<string, unknown>;
    const v = raw?.[key];
    const have = (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]).map(x => String(x).toLowerCase());
    const values = c.values.map(x => x.toLowerCase());
    const hit = have.some(x => values.includes(x));
    return c.op === 'in' ? hit : !hit;
  });
}

export const describeCondition = (c: Condition) => `${c.field} ${c.op === 'in' ? 'is' : 'is not'} ${c.values.join(' / ')}`;

// ---------- workflow file ----------

export const workflowNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  type: z.enum(NODE_TYPES as [NodeType, ...NodeType[]]),
  label: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  config: z.record(z.string(), z.unknown()).default({}),
  /** Skip this node when all these conditions hold; the run continues through skipPort (default: the node's first port). */
  skipIf: z.array(conditionSchema).optional(),
  skipPort: z.string().optional(),
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  port: z.string(),
  target: z.string(),
  /** How many times this edge may be followed in one run (loops such as fail -> implement). */
  maxLoops: z.number().int().positive().optional(),
  /** Where to go instead once maxLoops is used up (usually a human gate). Without it the run fails. */
  onLimit: z.string().optional(),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

export const workflowSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  name: z.string(),
  description: z.string().default(''),
  nodes: z.array(workflowNodeSchema).min(1),
  edges: z.array(workflowEdgeSchema),
});
export type WorkflowDefinition = z.infer<typeof workflowSchema>;

/** Structural checks the schema cannot express. Returns a list of problems (empty = valid). */
export function validateWorkflow(w: WorkflowDefinition): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of w.nodes) {
    if (ids.has(n.id)) problems.push(`Duplicate node id "${n.id}"`);
    ids.add(n.id);
    if (n.skipPort && !NODE_PORTS[n.type].includes(n.skipPort)) problems.push(`Node "${n.label}": skip port "${n.skipPort}" does not exist`);
    if (n.skipIf?.length && n.type === 'trigger.jira') problems.push('The trigger cannot be skipped');
    const cfg = nodeConfigSchemas[n.type].safeParse(n.config);
    if (!cfg.success) problems.push(`Node "${n.label}": ${cfg.error.issues.map(i => `${i.path.join('.') || 'config'} ${i.message}`).join('; ')}`);
  }
  const triggers = w.nodes.filter(n => n.type === 'trigger.jira');
  if (triggers.length !== 1) problems.push(`A workflow needs exactly one trigger (found ${triggers.length})`);
  const byId = new Map(w.nodes.map(n => [n.id, n]));
  const seen = new Set<string>();
  for (const e of w.edges) {
    const src = byId.get(e.source);
    if (!src) problems.push(`Edge ${e.id}: unknown source "${e.source}"`);
    if (!byId.has(e.target)) problems.push(`Edge ${e.id}: unknown target "${e.target}"`);
    if (e.onLimit && !byId.has(e.onLimit)) problems.push(`Edge ${e.id}: unknown onLimit target "${e.onLimit}"`);
    if (src && !NODE_PORTS[src.type].includes(e.port)) problems.push(`Edge ${e.id}: "${src.label}" has no port "${e.port}"`);
    const key = `${e.source}:${e.port}`;
    if (seen.has(key)) problems.push(`Port "${e.port}" of "${src?.label ?? e.source}" is connected twice`);
    seen.add(key);
  }
  if (triggers[0]) {
    const reach = new Set<string>([triggers[0].id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of w.edges) {
        for (const t of [e.target, e.onLimit]) if (t && reach.has(e.source) && !reach.has(t)) reach.add(t), (grew = true);
      }
    }
    for (const n of w.nodes) if (!reach.has(n.id)) problems.push(`Node "${n.label}" cannot be reached from the trigger`);
  }
  return problems;
}

// ---------- routing: which workflow a ticket starts ----------

export const routingSchema = z.object({
  default: z.string().default('default'),
  rules: z.array(z.object({ name: z.string().default(''), when: z.array(conditionSchema).min(1), workflow: z.string() })).default([]),
});
export type WorkflowRouting = z.infer<typeof routingSchema>;

/** First matching rule wins (issue fields only: classification is not known yet when a run starts). */
export function routeWorkflow(r: WorkflowRouting, issue: ConditionContext['issue']): string {
  return r.rules.find(rule => conditionsMatch(rule.when, { issue }))?.workflow ?? r.default;
}

/** Steps that only set a run up; a run may still switch workflow after them. */
const SETUP_NODE_TYPES: readonly string[] = ['trigger.jira', 'ai.classify'];

/** A run can switch to another workflow while it is active and no real step has finished yet (skipped steps don't count). */
export function canSwitchWorkflow(status: string, nodeRuns: { nodeType: string; status: string; output: Record<string, unknown> | null }[]): boolean {
  if (!['running', 'waiting', 'failed'].includes(status)) return false;
  return !nodeRuns.some(n => n.status === 'done' && !SETUP_NODE_TYPES.includes(n.nodeType) && !n.output?.skipped);
}

// ---------- runs ----------

export const workflowRunStatusSchema = z.enum(['running', 'waiting', 'failed', 'done', 'cancelled']);
export const nodeRunStatusSchema = z.enum(['queued', 'running', 'waiting', 'done', 'failed', 'cancelled']);

export const workflowRunSchema = z.object({
  id: z.string(),
  status: workflowRunStatusSchema,
  workflowId: z.string(),
  workflowHash: z.string(),
  trigger: z.string(),
  task: taskSchema,
  currentNodeId: z.string().nullable(),
  currentNodeLabel: z.string().nullable(),
  repoPath: z.string().nullable(),
  baseRef: z.string().nullable(),
  branch: z.string().nullable(),
  worktreePath: z.string().nullable(),
  error: z.string().nullable(),
  costUsd: z.number(),
  vars: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type WorkflowRunDto = z.infer<typeof workflowRunSchema>;

export const nodeRunSchema = z.object({
  id: z.string(),
  seq: z.number(),
  nodeId: z.string(),
  nodeType: z.string(),
  attempt: z.number(),
  status: nodeRunStatusSchema,
  port: z.string().nullable(),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  costUsd: z.number().nullable(),
  numTurns: z.number().nullable(),
  skillHash: z.string().nullable(),
  agentSessionId: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  waitingMs: z.number().nullable(),
});
export type NodeRunDto = z.infer<typeof nodeRunSchema>;

export const artifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number(),
  author: z.enum(['ai', 'user']),
  content: z.string(),
  nodeRunId: z.string().nullable(),
  createdAt: z.string(),
});
export type ArtifactDto = z.infer<typeof artifactSchema>;

export const workflowRunDetailSchema = workflowRunSchema.extend({
  task: taskDetailSchema,
  workflow: workflowSchema,
  nodeRuns: z.array(nodeRunSchema),
  artifacts: z.array(artifactSchema), // every version, newest first
  events: z.array(z.object({ id: z.string(), actor: z.string(), action: z.string(), detail: z.record(z.string(), z.unknown()), createdAt: z.string() })),
  evaluation: z.object({ scores: z.record(z.string(), z.number()), note: z.string().nullable() }).nullable(),
  mappedRepo: z.string().nullable(),
  /** Workplace the task resolves to (Repos page). */
  workplace: z.object({ id: z.string().nullable(), brand: z.string().nullable(), repository: z.string().nullable(), origin: z.string().nullable(), path: z.string() }).nullable(),
});
export type WorkflowRunDetail = z.infer<typeof workflowRunDetailSchema>;

export const workflowRunListSchema = z.object({ runs: z.array(workflowRunSchema), counts: z.record(z.string(), z.number()) });
export type WorkflowRunList = z.infer<typeof workflowRunListSchema>;

// ---------- user actions ----------

export const gateActionSchema = z.object({
  action: z.enum(['approved', 'changes', 'rejected']),
  /** Sent back to the AI when action = changes; kept as a note otherwise. */
  feedback: z.string().max(10000).optional(),
  /** Edited artifacts (name -> new content), saved as user versions before moving on. */
  edits: z.record(z.string(), z.string().max(200_000)).optional(),
});
export type GateAction = z.infer<typeof gateActionSchema>;

/** Confirm (post the comment / push + open the PR) or skip a confirm node. The text is exactly what was shown. */
export const confirmActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('confirm'),
    confirm: z.literal(true),
    text: z.string().min(1).max(60_000),
    title: z.string().min(1).max(300).optional(),
    targetBranch: z.string().min(1).max(200).optional(),
  }),
  z.object({ action: z.literal('skip'), note: z.string().max(2000).optional() }),
]);
export type ConfirmAction = z.infer<typeof confirmActionSchema>;

/** Pick who does a waiting agent.run step, or finish an editor hand-off. */
export const executorActionSchema = z.object({ executor: z.enum(AGENT_EXECUTORS) });
export const handoffActionSchema = z.object({ outcome: z.enum(['done', 'failed']), note: z.string().max(4000).optional() });

export const prCommentActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('confirm'), confirm: z.literal(true), text: z.string().min(1).max(60_000) }),
  z.object({ action: z.literal('skip') }),
]);

export const evaluateActionSchema = z.object({
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  note: z.string().max(4000).optional(),
});
export type EvaluateAction = z.infer<typeof evaluateActionSchema>;

// ---------- editor support ----------

/** JSON Schema (input side, defaults included) of each node type's config, for generated forms in the editor. */
export function nodeConfigJsonSchema(type: NodeType): { properties?: Record<string, any>; required?: string[] } {
  return z.toJSONSchema(nodeConfigSchemas[type], { io: 'input', unrepresentable: 'any' }) as never;
}

export const NODE_TYPE_INFO: Record<NodeType, { title: string; description: string }> = {
  'trigger.jira': { title: 'Jira trigger', description: 'Start: the ticket (description, comments, attachments) is the input.' },
  'ai.classify': { title: 'Classify', description: 'AI (rules as fallback) labels the ticket: bug, feature, chore, research or question; later nodes can be skipped by type.' },
  'ai.step': { title: 'AI step', description: 'Read-only claude -p with a skill; writes one document.' },
  'human.gate': { title: 'You review', description: 'Waits for you: edit, approve, send back with feedback, or reject.' },
  'agent.run': { title: 'Agent run', description: 'Claude Code works in the ticket worktree and commits locally.' },
  'check.command': { title: 'Checks', description: 'Runs shell commands in the worktree (tests, lint); pass or fail.' },
  'ai.review': { title: 'AI review', description: 'Reviews the diff against the spec with skills; ends PASS or FAIL.' },
  'doc.write': { title: 'Ticket doc', description: 'AI writes the ticket document into the repo (docs/<KEY>-<slug>.md) and commits it on the ticket branch.' },
  'jira.comment': { title: 'Jira comment', description: 'AI drafts a comment with the Jira-comment skill; posted only after you confirm.' },
  'git.pr': { title: 'Pull request', description: 'AI drafts the PR; after you confirm, the branch is pushed and a Bitbucket PR is opened.' },
  'pr.comment': { title: 'Comment on PR', description: 'Posts the review you approved as a comment on the member\'s Bitbucket PR, only after you confirm.' },
  evaluate: { title: 'Score', description: 'You score the result per criterion; closes the run.' },
};


export const trySkillSchema = z.object({
  taskId: z.string().uuid(),
  prompt: z.string().min(1).max(20_000).default('Apply the skill to this ticket.\n\n{{issue}}'),
});

// ---------- metrics ----------

/** GET /api/metrics: aggregates for tuning workflows and skills. */
export interface MetricsReport {
  window: { days: number; workflowId: string | null; runs: number };
  overview: { done: number; failed: number; cancelled: number; active: number; avgCostUsd: number | null; avgMinutes: number | null; avgWaitMinutes: number | null; avgScore: number | null };
  versions: { workflowId: string; hash: string; firstRun: string; runs: number; done: number; failed: number; cancelled: number; avgCostUsd: number | null; avgMinutes: number | null; avgScore: number | null; criteria: Record<string, number> }[];
  nodes: {
    workflowId: string; nodeId: string; label: string; type: string; runs: number; skipped: number; failed: number; retries: number;
    avgSeconds: number | null; avgCostUsd: number | null; gate?: { approved: number; edited: number; changes: number; rejected: number; avgWaitMinutes: number | null };
    review?: { pass: number; fail: number };
  }[];
  skills: { path: string; hash: string; current: boolean; nodeIds: string[]; uses: number; avgCostUsd: number | null; acceptedAsIs: number; edited: number; sentBack: number }[];
  evaluations: { runId: string; taskKey: string | null; workflowHash: string; scores: Record<string, number>; note: string | null; createdAt: string }[];
}

