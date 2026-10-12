import { z } from 'zod';
import { taskDetailSchema, taskSchema } from './tasks';

// ---------- node types ----------

const tools = z.array(z.string()).default(['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git diff:*)']);
const artifactName = z.string().regex(/^[a-z][a-z0-9_-]*$/, 'lowercase name, e.g. analysis');

export const nodeConfigSchemas = {
  'trigger.jira': z.object({}).default({}),
  'ai.step': z.object({
    skill: z.string().optional(),
    prompt: z.string().min(1),
    inputs: z.array(artifactName).default([]),
    output: artifactName,
    allowedTools: tools,
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
    model: z.string().optional(),
    maxBudgetUsd: z.number().positive().optional(),
    timeoutSeconds: z.number().int().positive().default(900),
  }),
  evaluate: z.object({
    criteria: z.array(z.string().min(1)).min(1).default(['Meets the requirement', 'Code quality', 'Tests', 'Documentation']),
  }),
} as const;

export type NodeType = keyof typeof nodeConfigSchemas;
export const NODE_TYPES = Object.keys(nodeConfigSchemas) as NodeType[];

export const NODE_PORTS: Record<NodeType, readonly string[]> = {
  'trigger.jira': ['next'],
  'ai.step': ['next'],
  'human.gate': ['approved', 'changes', 'rejected'],
  'agent.run': ['done', 'failed'],
  'check.command': ['pass', 'fail'],
  'ai.review': ['pass', 'fail'],
  evaluate: ['end'],
};

/** Node types that wait for the user instead of running. */
export const HUMAN_NODE_TYPES: readonly NodeType[] = ['human.gate', 'evaluate'];

// ---------- workflow file ----------

export const workflowNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/),
  type: z.enum(NODE_TYPES as [NodeType, ...NodeType[]]),
  label: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  config: z.record(z.string(), z.unknown()).default({}),
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

export const evaluateActionSchema = z.object({
  scores: z.record(z.string(), z.number().int().min(1).max(5)),
  note: z.string().max(4000).optional(),
});
export type EvaluateAction = z.infer<typeof evaluateActionSchema>;
