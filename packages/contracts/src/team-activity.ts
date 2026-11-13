import { z } from 'zod';

/**
 * What the team is doing right now (Team page → Live, MCP `team_activity`): one entry per role with its active
 * steps and its last finished step, plus steps no role covers and steps waiting for the person. Read only.
 */
export const AGENT_STATES = ['running', 'queued', 'waiting', 'failed', 'idle'] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export const agentStepSchema = z.object({
  runId: z.string(),
  nodeRunId: z.string(),
  taskKey: z.string().nullable(),
  taskTitle: z.string(),
  projectSlug: z.string().nullable(),
  workflowId: z.string(),
  step: z.string(),
  stepLabel: z.string(),
  nodeType: z.string(),
  status: z.enum(['queued', 'running', 'waiting', 'done', 'failed', 'cancelled']),
  attempt: z.number(),
  /** Engine or executor the step uses, when known (claude, gemini, antigravity, editor:cursor…). */
  engine: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  costUsd: z.number().nullable(),
  numTurns: z.number().nullable(),
  /** Short step report (Summary section) and what it asks the person to decide, once the step has ended. */
  summary: z.string().nullable(),
  confidence: z.string().nullable(),
  decisionNeeded: z.string().nullable(),
  /** First line of the error, for a failed step. */
  error: z.string().nullable(),
});
export type AgentStep = z.infer<typeof agentStepSchema>;

export const agentActivitySchema = z.object({
  /** Role key, or null for the "no role" lane. */
  roleKey: z.string().nullable(),
  state: z.enum(AGENT_STATES),
  /** Active steps (queued, running, or waiting for a confirmation), newest first. */
  current: z.array(agentStepSchema),
  /** Most recent step that ended (done or failed) in the window. */
  last: agentStepSchema.nullable(),
  /** Steps that ended in the window. */
  stats: z.object({ done: z.number(), failed: z.number(), costUsd: z.number() }),
});
export type AgentActivity = z.infer<typeof agentActivitySchema>;

export const teamActivitySchema = z.object({
  generatedAt: z.string(),
  /** Window of `last` and `stats`, in hours. */
  windowHours: z.number(),
  agents: z.array(agentActivitySchema),
  /** Review gates and evaluations waiting for the person. */
  waitingForYou: z.array(agentStepSchema),
});
export type TeamActivity = z.infer<typeof teamActivitySchema>;

export const teamActivityQuerySchema = z.object({
  project: z.string().optional(),
  hours: z.coerce.number().int().min(1).max(168).default(24),
});
