import { sql } from 'kysely';
import type { MetricsReport, WorkflowDefinition } from '@ot/contracts';
import type { Db } from '@ot/db';
import type { SkillCatalog } from '@ot/mod-skills';

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Aggregates for tuning workflows and skills. Everything is computed from runs started in the last `days` days. */
export async function computeMetrics(db: Db, skills: SkillCatalog, opts: { days: number; workflowId?: string }): Promise<MetricsReport> {
  let q = db
    .selectFrom('workflow_runs as r')
    .innerJoin('tasks as t', 't.id', 'r.task_id')
    .leftJoin('evaluations as e', 'e.run_id', 'r.id')
    .select(['r.id', 'r.workflow_id', 'r.workflow_hash', 'r.workflow_snapshot', 'r.status', 'r.created_at', 'r.finished_at', 't.key', 'e.scores', 'e.note', 'e.created_at as evaluated_at'])
    .where('r.created_at', '>', sql<Date>`now() - make_interval(days => ${opts.days})`)
    .orderBy('r.created_at', 'desc')
    .limit(2000);
  if (opts.workflowId) q = q.where('r.workflow_id', '=', opts.workflowId);
  const runs = await q.execute();
  const ids = runs.map(r => r.id);
  const nodeRuns = ids.length ? await db.selectFrom('node_runs').selectAll().where('run_id', 'in', ids).orderBy('run_id').orderBy('seq').execute() : [];
  const artifacts = ids.length
    ? await db.selectFrom('artifacts').select(['run_id', 'node_run_id', 'name', 'author', 'version']).where('run_id', 'in', ids).execute()
    : [];

  const byRun = new Map<string, typeof nodeRuns>();
  for (const n of nodeRuns) byRun.set(n.run_id, [...(byRun.get(n.run_id) ?? []), n]);
  const costOf = (runId: string) => (byRun.get(runId) ?? []).reduce((a, n) => a + (n.cost_usd ?? 0), 0);
  const waitOf = (runId: string) => (byRun.get(runId) ?? []).reduce((a, n) => a + Number(n.waiting_ms ?? 0), 0);
  const scoreOf = (s: unknown) => avg(Object.values((s ?? {}) as Record<string, number>));
  const finished = runs.filter(r => r.status === 'done');

  const overview = {
    done: finished.length,
    failed: runs.filter(r => r.status === 'failed').length,
    cancelled: runs.filter(r => r.status === 'cancelled').length,
    active: runs.filter(r => r.status === 'running' || r.status === 'waiting').length,
    avgCostUsd: round(avg(finished.map(r => costOf(r.id)))),
    avgMinutes: round(avg(finished.filter(r => r.finished_at).map(r => (new Date(r.finished_at!).getTime() - new Date(r.created_at).getTime()) / 60000)), 1),
    avgWaitMinutes: round(avg(finished.map(r => waitOf(r.id) / 60000)), 1),
    avgScore: round(avg(runs.map(r => scoreOf(r.scores)).filter((x): x is number => x != null))),
  };

  // per workflow version
  const versionKey = (r: (typeof runs)[number]) => `${r.workflow_id}@${r.workflow_hash}`;
  const versions = [...new Set(runs.map(versionKey))].map(key => {
    const rs = runs.filter(r => versionKey(r) === key);
    const done = rs.filter(r => r.status === 'done');
    const crit: Record<string, number[]> = {};
    for (const r of rs) for (const [k, v] of Object.entries((r.scores ?? {}) as Record<string, number>)) (crit[k] ??= []).push(v);
    return {
      workflowId: rs[0]!.workflow_id, hash: rs[0]!.workflow_hash, firstRun: new Date(rs.at(-1)!.created_at).toISOString(), runs: rs.length,
      done: done.length, failed: rs.filter(r => r.status === 'failed').length, cancelled: rs.filter(r => r.status === 'cancelled').length,
      avgCostUsd: round(avg(done.map(r => costOf(r.id)))),
      avgMinutes: round(avg(done.filter(r => r.finished_at).map(r => (new Date(r.finished_at!).getTime() - new Date(r.created_at).getTime()) / 60000)), 1),
      avgScore: round(avg(rs.map(r => scoreOf(r.scores)).filter((x): x is number => x != null))),
      criteria: Object.fromEntries(Object.entries(crit).map(([k, v]) => [k, round(avg(v))!])),
    };
  });

  // per node (label/type from the newest snapshot that has it)
  const nodeInfo = new Map<string, { label: string; type: string }>();
  for (const r of runs) for (const n of (r.workflow_snapshot as WorkflowDefinition).nodes) if (!nodeInfo.has(`${r.workflow_id}:${n.id}`)) nodeInfo.set(`${r.workflow_id}:${n.id}`, { label: n.label, type: n.type });
  const runWf = new Map(runs.map(r => [r.id, r.workflow_id]));
  const nodeKeys = [...new Set(nodeRuns.map(n => `${runWf.get(n.run_id)}:${n.node_id}`))];
  const nodes = nodeKeys.map(key => {
    const [workflowId, nodeId] = key.split(':') as [string, string];
    const ns = nodeRuns.filter(n => runWf.get(n.run_id) === workflowId && n.node_id === nodeId);
    const worked = ns.filter(n => !(n.output as { skipped?: boolean })?.skipped);
    const info = nodeInfo.get(key) ?? { label: nodeId, type: ns[0]!.node_type };
    const timed = worked.filter(n => n.started_at && n.ended_at && n.node_type !== 'human.gate' && n.node_type !== 'evaluate');
    const row: MetricsReport['nodes'][number] = {
      workflowId, nodeId, label: info.label, type: info.type, runs: worked.length,
      skipped: ns.length - worked.length, failed: worked.filter(n => n.status === 'failed').length, retries: worked.filter(n => n.attempt > 1).length,
      avgSeconds: round(avg(timed.map(n => (new Date(n.ended_at!).getTime() - new Date(n.started_at!).getTime()) / 1000)), 0),
      avgCostUsd: round(avg(worked.filter(n => n.cost_usd != null).map(n => n.cost_usd!)), 3),
    };
    if (info.type === 'human.gate') {
      const out = (n: (typeof ns)[number]) => (n.output ?? {}) as { edited?: string[] };
      row.gate = {
        approved: worked.filter(n => n.port === 'approved' && !out(n).edited?.length).length,
        edited: worked.filter(n => n.port === 'approved' && !!out(n).edited?.length).length,
        changes: worked.filter(n => n.port === 'changes').length,
        rejected: worked.filter(n => n.port === 'rejected').length,
        avgWaitMinutes: round(avg(worked.filter(n => n.waiting_ms != null).map(n => Number(n.waiting_ms) / 60000)), 1),
      };
    }
    if (info.type === 'ai.review' || info.type === 'check.command') row.review = { pass: worked.filter(n => n.port === 'pass').length, fail: worked.filter(n => n.port === 'fail').length };
    return row;
  });

  // per skill version: what happened to the document at the next gate (accepted as-is / edited / sent back)
  const current = new Map(skills.list().map(s => [s.path, s.hash]));
  const skillRows = new Map<string, MetricsReport['skills'][number]>();
  const isCurrent = (paths: string[], hash: string) => {
    const hashes = hash.split(',');
    return paths.length > 0 && paths.length === hashes.length && paths.every((p, i) => current.get(p) === hashes[i]);
  };
  for (const r of runs) {
    const def = r.workflow_snapshot as WorkflowDefinition;
    const list = byRun.get(r.id) ?? [];
    for (const n of list) {
      if (!n.skill_hash || (n.output as { skipped?: boolean })?.skipped) continue;
      const cfg = def.nodes.find(x => x.id === n.node_id)?.config as { skill?: string; skills?: string[]; output?: string } | undefined;
      const path = cfg?.skill ?? cfg?.skills?.join(' + ') ?? '?';
      const key = `${path}@${n.skill_hash}`;
      const row = skillRows.get(key) ?? {
        path, hash: n.skill_hash, current: isCurrent(cfg?.skill ? [cfg.skill] : cfg?.skills ?? [], n.skill_hash), nodeIds: [], uses: 0, avgCostUsd: null, acceptedAsIs: 0, edited: 0, sentBack: 0,
      };
      const costs = row.uses && row.avgCostUsd != null ? row.avgCostUsd * row.uses : 0;
      row.uses += 1;
      row.avgCostUsd = round((costs + (n.cost_usd ?? 0)) / row.uses, 3);
      if (!row.nodeIds.includes(n.node_id)) row.nodeIds.push(n.node_id);
      const gate = list.find(g => g.seq > n.seq && g.node_type === 'human.gate' && g.status === 'done');
      const name = cfg?.output;
      if (gate && name) {
        const userEdit = artifacts.some(a => a.run_id === r.id && a.node_run_id === gate.id && a.name === name && a.author === 'user');
        if (gate.port === 'changes') row.sentBack += 1;
        else if (gate.port === 'approved' && userEdit) row.edited += 1;
        else if (gate.port === 'approved') row.acceptedAsIs += 1;
      }
      skillRows.set(key, row);
    }
  }

  return {
    window: { days: opts.days, workflowId: opts.workflowId ?? null, runs: runs.length },
    overview,
    versions,
    nodes,
    skills: [...skillRows.values()].sort((a, b) => a.path.localeCompare(b.path) || Number(b.current) - Number(a.current)),
    evaluations: runs
      .filter(r => r.scores)
      .map(r => ({ runId: r.id, taskKey: r.key, workflowHash: r.workflow_hash, scores: r.scores as Record<string, number>, note: r.note, createdAt: new Date(r.evaluated_at ?? r.created_at).toISOString() }))
      .slice(0, 50),
  };
}
