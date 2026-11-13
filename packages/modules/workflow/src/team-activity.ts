import { HUMAN_NODE_TYPES, MODEL_NODE_TYPES, type AgentActivity, type AgentState, type AgentStep, type NodeType, type TeamActivity, type WorkflowDefinition } from '@tesserax/contracts';
import { redact } from '@tesserax/contracts';
import type { Db } from '@tesserax/db';

/** One node run joined with its run and task, as the activity query returns it. */
export interface ActivityRow {
  id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  status: string;
  attempt: number;
  role: string | null;
  model: string | null;
  cost_usd: number | null;
  num_turns: number | null;
  summary: string | null;
  confidence: string | null;
  decision_needed: string | null;
  error: string | null;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  created_at: Date | string;
  workflow_id: string;
  workflow_snapshot: unknown;
  task_key: string | null;
  task_title: string;
  project_slug: string | null;
}

const ACTIVE = ['queued', 'running', 'waiting'];
const ENDED = ['done', 'failed'];
const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
const time = (d: Date | string | null) => (d == null ? 0 : new Date(d).getTime());
const firstLine = (s: string | null) => (s ? s.split('\n').find(l => l.trim())?.trim().slice(0, 300) ?? null : null);

function nodeOf(row: ActivityRow) {
  const nodes = (row.workflow_snapshot as WorkflowDefinition | null)?.nodes ?? [];
  return nodes.find(n => n.id === row.node_id);
}

/** The role a step works as: recorded once it started, else what its node names. */
export function roleOf(row: ActivityRow): string | null {
  if (row.role) return row.role;
  const r = (nodeOf(row)?.config as { role?: unknown } | undefined)?.role;
  return typeof r === 'string' && r ? r : null;
}

function step(row: ActivityRow, env: Record<string, string | undefined>): AgentStep {
  const node = nodeOf(row);
  const cfg = (node?.config ?? {}) as { engine?: string; executor?: string };
  const engine = cfg.engine ?? (cfg.executor && cfg.executor !== 'ask' ? cfg.executor : null);
  const text = (s: string | null) => (s == null ? null : redact(s, env));
  return {
    runId: row.run_id,
    nodeRunId: row.id,
    taskKey: row.task_key,
    taskTitle: row.task_title,
    projectSlug: row.project_slug,
    workflowId: row.workflow_id,
    step: row.node_id,
    stepLabel: node?.label || row.node_id,
    nodeType: row.node_type,
    status: row.status as AgentStep['status'],
    attempt: row.attempt,
    engine: engine ?? null,
    model: row.model,
    startedAt: iso(row.started_at),
    endedAt: iso(row.ended_at),
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    numTurns: row.num_turns,
    summary: text(row.summary),
    confidence: row.confidence,
    decisionNeeded: text(row.decision_needed),
    error: text(firstLine(row.error)),
  };
}

const isHuman = (t: string) => (HUMAN_NODE_TYPES as readonly string[]).includes(t);
const isAi = (t: string) => (MODEL_NODE_TYPES as readonly string[]).includes(t as NodeType);

function stateOf(current: AgentStep[], last: AgentStep | null): AgentState {
  if (current.some(s => s.status === 'running')) return 'running';
  if (current.some(s => s.status === 'queued')) return 'queued';
  if (current.some(s => s.status === 'waiting')) return 'waiting';
  return last?.status === 'failed' ? 'failed' : 'idle';
}

/**
 * Groups node runs by role. Steps without a role count only when they are AI steps (the "no role" lane);
 * review gates and evaluations waiting for the person go to `waitingForYou`. Roles with nothing in the window are left
 * out: the caller lists the team and shows those as idle.
 */
export function buildTeamActivity(rows: ActivityRow[], opts: { now?: Date; windowHours: number; env?: Record<string, string | undefined> }): TeamActivity {
  const env = opts.env ?? {};
  const byRole = new Map<string | null, { current: AgentStep[]; ended: AgentStep[] }>();
  const waitingForYou: AgentStep[] = [];
  const sorted = [...rows].sort((a, b) => time(b.started_at ?? b.created_at) - time(a.started_at ?? a.created_at));
  for (const row of sorted) {
    if (isHuman(row.node_type)) {
      if (row.status === 'waiting') waitingForYou.push(step(row, env));
      continue;
    }
    const role = roleOf(row);
    if (!role && !isAi(row.node_type)) continue;
    const bucket = byRole.get(role) ?? { current: [], ended: [] };
    byRole.set(role, bucket);
    if (ACTIVE.includes(row.status)) bucket.current.push(step(row, env));
    else if (ENDED.includes(row.status)) bucket.ended.push(step(row, env));
  }
  const agents: AgentActivity[] = [...byRole.entries()].map(([roleKey, b]) => {
    const ended = b.ended.sort((x, y) => time(y.endedAt) - time(x.endedAt));
    const last = ended[0] ?? null;
    return {
      roleKey,
      state: stateOf(b.current, last),
      current: b.current,
      last,
      stats: {
        done: ended.filter(s => s.status === 'done').length,
        failed: ended.filter(s => s.status === 'failed').length,
        costUsd: Math.round(ended.reduce((sum, s) => sum + (s.costUsd ?? 0), 0) * 10_000) / 10_000,
      },
    };
  });
  agents.sort((a, b) => (a.roleKey === null ? 1 : b.roleKey === null ? -1 : a.roleKey.localeCompare(b.roleKey)));
  return { generatedAt: (opts.now ?? new Date()).toISOString(), windowHours: opts.windowHours, agents, waitingForYou };
}

/** Active steps plus the steps that ended in the last `hours`, optionally for one project. */
export async function queryActivityRows(db: Db, opts: { project?: string; hours: number; now?: Date }): Promise<ActivityRow[]> {
  const since = new Date((opts.now ?? new Date()).getTime() - opts.hours * 3600_000);
  return db
    .selectFrom('node_runs as n')
    .innerJoin('workflow_runs as r', 'r.id', 'n.run_id')
    .innerJoin('tasks as t', 't.id', 'r.task_id')
    .leftJoin('projects as p', 'p.id', 'r.project_id')
    .select([
      'n.id', 'n.run_id', 'n.node_id', 'n.node_type', 'n.status', 'n.attempt', 'n.role', 'n.model', 'n.cost_usd', 'n.num_turns',
      'n.summary', 'n.confidence', 'n.decision_needed', 'n.error', 'n.started_at', 'n.ended_at', 'n.created_at',
      'r.workflow_id', 'r.workflow_snapshot', 't.key as task_key', 't.title as task_title', 'p.slug as project_slug',
    ])
    .where(eb => eb.or([
      eb.and([eb('n.status', 'in', ['queued', 'running', 'waiting']), eb('r.status', 'in', ['running', 'waiting'])]),
      eb.and([eb('n.status', 'in', ['done', 'failed']), eb('n.ended_at', '>=', since)]),
    ]))
    .$if(!!opts.project, q => q.where('p.slug', '=', opts.project!))
    .orderBy('n.created_at', 'desc')
    .limit(2000)
    .execute() as Promise<ActivityRow[]>;
}
