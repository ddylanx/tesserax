import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { dataDir, type AppConfig } from '@ot/config';
import {
  CONFIRM_NODE_TYPES, HUMAN_NODE_TYPES, NODE_PORTS, conditionsMatch, describeCondition, routeWorkflow,
  type ArtifactDto, type ConfirmAction, type EvaluateAction, type GateAction, type NodeType, type WorkflowDefinition, type WorkflowEdge,
  type WorkflowNode, type WorkflowRunDetail, type WorkflowRunDto, type WorkflowRunList,
} from '@ot/contracts';
import { CONFIG, DB, QUEUE, WorkContext, createLogger, type Queue } from '@ot/core';
import type { Db, NodeRun, NodeRunUpdate, WorkflowRun, WorkflowRunUpdate } from '@ot/db';
import { RepoMapStore, diffInfo, ensureWorktree, fetchBase, isAlive, resolveBaseRef, stopProcess } from '@ot/mod-pipeline';
import { BitbucketClient, parseBitbucketRemote, pushBranch, remoteUrl } from './bitbucket';
import { TasksService } from '@ot/mod-tasks';
import { RoutingStore, WorkflowStore } from './stores';

const log = createLogger('workflow');
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export const NODE_QUEUE = 'wf.node';
export const FINALIZE_QUEUE = 'wf.finalize';
export const STEP_RETRY = { retryLimit: 3, retryDelay: 5, retryBackoff: true };
const ACTIVE = ['running', 'waiting', 'failed'] as const;

export class RunConflict extends Error {}

export type RunListener = (run: WorkflowRunDto, event: 'waiting' | 'failed' | 'done') => Promise<void> | void;

@Injectable()
export class WorkflowEngine {
  readonly workflows = new WorkflowStore();
  readonly routing = new RoutingStore();
  readonly repos = new RepoMapStore();
  private listeners: RunListener[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tasks: TasksService,
  ) {}

  onRunEvent(fn: RunListener) {
    this.listeners.push(fn);
  }

  private async emit(runId: string, event: 'waiting' | 'failed' | 'done') {
    if (!this.listeners.length) return;
    const run = await this.getRun(runId);
    if (run) for (const fn of this.listeners) await Promise.resolve(fn(run, event)).catch(err => log.warn({ err }, 'run listener failed'));
  }

  async event(runId: string, actor: string, action: string, detail: Record<string, unknown> = {}, nodeRunId: string | null = null) {
    await this.db
      .insertInto('run_events')
      .values({ run_id: runId, node_run_id: nodeRunId, actor, action, detail: JSON.stringify(detail), correlation_id: WorkContext.correlationId() ?? null })
      .execute();
  }

  async patchRun(runId: string, patch: WorkflowRunUpdate) {
    await this.db.updateTable('workflow_runs').set({ ...patch, updated_at: new Date() }).where('id', '=', runId).execute();
  }

  async patchNode(nodeRunId: string, patch: NodeRunUpdate) {
    await this.db.updateTable('node_runs').set(patch).where('id', '=', nodeRunId).execute();
  }

  graph(run: Pick<WorkflowRun, 'workflow_snapshot'>): WorkflowDefinition {
    return run.workflow_snapshot as WorkflowDefinition;
  }

  node(run: Pick<WorkflowRun, 'workflow_snapshot'>, nodeId: string): WorkflowNode {
    const n = this.graph(run).nodes.find(x => x.id === nodeId);
    if (!n) throw new Error(`Node ${nodeId} is not in this run's workflow`);
    return n;
  }

  // ---------- lifecycle ----------

  /** Starts a run of a workflow for a task. Returns the existing active run if the task already has one. */
  /** Starts a run; without a workflow id the routing rules (workflows/routing.json) pick one. */
  async startRun(taskId: string, trigger: 'new_issue' | 'manual', requested?: string): Promise<{ runId: string; created: boolean; workflowId: string }> {
    const task = await this.tasks.getTask(taskId);
    if (!task) throw new Error('Task not found');
    const workflowId = requested || routeWorkflow(this.routing.read(), task);
    const { def, hash, problems } = this.workflows.load(workflowId);
    if (problems.length) throw new Error(`Workflow ${workflowId} is invalid: ${problems.join('; ')}`);
    const triggerNode = def.nodes.find(n => n.type === 'trigger.jira')!;
    const inserted = await this.db
      .insertInto('workflow_runs')
      .values({
        task_id: taskId, workflow_id: def.id, workflow_hash: hash, workflow_snapshot: JSON.stringify(def), trigger,
        branch: `ot/${(task.key ?? taskId.slice(0, 8)).replace(/[^A-Za-z0-9._-]+/g, '-')}`,
      })
      .returning('id')
      .executeTakeFirst()
      .catch(err => {
        if ((err as { code?: string }).code === '23505') return undefined; // one active run per task
        throw err;
      });
    if (!inserted) {
      const existing = await this.db.selectFrom('workflow_runs').select('id').where('task_id', '=', taskId).where('status', 'in', [...ACTIVE]).executeTakeFirstOrThrow();
      return { runId: existing.id, created: false, workflowId };
    }
    await this.event(inserted.id, trigger === 'manual' ? 'user' : 'system', 'run_started', { workflow: def.id, hash });
    await this.enqueue(inserted.id, triggerNode.id, null, {});
    return { runId: inserted.id, created: true, workflowId };
  }

  /** Creates the next node run. Human nodes wait for the user; others are queued as pg-boss jobs. */
  async enqueue(runId: string, nodeId: string, viaEdge: string | null, input: Record<string, unknown>): Promise<NodeRun> {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    const node = this.node(run, nodeId);
    if (node.skipIf?.length) {
      const task = await this.tasks.getTask(run.task_id);
      const vars = (run.vars ?? {}) as { classification?: { type?: string; automation?: string } };
      if (task && conditionsMatch(node.skipIf, { issue: task, classification: vars.classification ?? null })) {
        return this.skip(run.id, node.id, node.skipPort ?? NODE_PORTS[node.type][0]!, viaEdge, node.skipIf.map(describeCondition).join(' and '));
      }
    }
    const human = HUMAN_NODE_TYPES.includes(node.type);
    const nodeRun = await this.db.transaction().execute(async trx => {
      const agg = await trx
        .selectFrom('node_runs')
        .select([sql<number>`coalesce(max(seq), 0)::int`.as('seq'), sql<number>`count(*) filter (where node_id = ${nodeId})::int`.as('n')])
        .where('run_id', '=', runId)
        .executeTakeFirstOrThrow();
      const nr = await trx
        .insertInto('node_runs')
        .values({
          run_id: runId, seq: agg.seq + 1, node_id: nodeId, node_type: node.type, attempt: agg.n + 1, via_edge: viaEdge,
          status: human ? 'waiting' : 'queued', input: JSON.stringify(input), started_at: human ? new Date() : null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('workflow_runs')
        .set({ current_node_id: nodeId, status: human ? 'waiting' : 'running', error: null, updated_at: new Date() })
        .where('id', '=', runId)
        .execute();
      return nr;
    });
    await this.event(runId, 'system', human ? 'waiting_for_user' : 'node_queued', { node: nodeId, label: node.label, attempt: nodeRun.attempt }, nodeRun.id);
    if (human) await this.emit(runId, 'waiting');
    else await this.queue.send(NODE_QUEUE, { nodeRunId: nodeRun.id }, { singletonKey: `wf:${nodeRun.id}`, ...STEP_RETRY });
    return nodeRun;
  }

  /** Records a skipped node (done, no work) and moves on through `port`. */
  private async skip(runId: string, nodeId: string, port: string, viaEdge: string | null, reason: string): Promise<NodeRun> {
    const nr = await this.db.transaction().execute(async trx => {
      const agg = await trx
        .selectFrom('node_runs')
        .select([sql<number>`coalesce(max(seq), 0)::int`.as('seq'), sql<number>`count(*) filter (where node_id = ${nodeId})::int`.as('n')])
        .where('run_id', '=', runId)
        .executeTakeFirstOrThrow();
      return trx
        .insertInto('node_runs')
        .values({
          run_id: runId, seq: agg.seq + 1, node_id: nodeId, node_type: this.node(await trx.selectFrom('workflow_runs').select('workflow_snapshot').where('id', '=', runId).executeTakeFirstOrThrow(), nodeId).type,
          attempt: agg.n + 1, via_edge: viaEdge, status: 'done', port, output: JSON.stringify({ skipped: true, reason }), started_at: new Date(), ended_at: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    await this.event(runId, 'system', 'node_skipped', { node: nodeId, port, reason }, nr.id);
    await this.route(runId, nodeId, port, {});
    return nr;
  }

  /** Finishes a node run through `port` and moves the run along the matching edge (loop limits applied). */
  async complete(nodeRunId: string, port: string, output: Record<string, unknown>, actor: 'job' | 'user', from: string[] = ['running', 'waiting']) {
    const nr = await this.db
      .updateTable('node_runs')
      .set({
        status: 'done', port, output: JSON.stringify(output), ended_at: new Date(),
        waiting_ms: sql`case when node_type in ('human.gate', 'evaluate') then (extract(epoch from (now() - started_at)) * 1000)::bigint else waiting_ms end`,
      })
      .where('id', '=', nodeRunId)
      .where('status', 'in', from as never)
      .returningAll()
      .executeTakeFirst();
    if (!nr) throw new RunConflict('This step is no longer active (it finished or was cancelled). Refresh the page.');
    await this.event(nr.run_id, actor, 'node_done', { node: nr.node_id, port }, nr.id);
    await this.route(nr.run_id, nr.node_id, port, output);
  }

  /** Follows the edge leaving `nodeId` through `port`: next node, loop fallback, or the end of the run. */
  private async route(runId: string, nodeId: string, port: string, output: Record<string, unknown>) {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (run.status === 'cancelled') return;
    const edge = this.graph(run).edges.find(e => e.source === nodeId && e.port === port);
    if (!edge) return this.finish(run.id, port === 'rejected' ? 'rejected' : 'completed');
    const next = await this.followEdge(run.id, edge);
    if (!next) return;
    const feedback = typeof output.feedback === 'string' && port === 'changes' ? output.feedback : null;
    await this.enqueue(run.id, next.target, next.via, feedback ? { feedback } : {});
  }

  private async followEdge(runId: string, edge: WorkflowEdge): Promise<{ target: string; via: string } | null> {
    if (!edge.maxLoops) return { target: edge.target, via: edge.id };
    const used = await this.db
      .selectFrom('node_runs')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('run_id', '=', runId)
      .where('via_edge', '=', edge.id)
      .executeTakeFirstOrThrow();
    if (used.n < edge.maxLoops) return { target: edge.target, via: edge.id };
    await this.event(runId, 'system', 'loop_limit', { edge: edge.id, maxLoops: edge.maxLoops, onLimit: edge.onLimit ?? null });
    if (edge.onLimit) return { target: edge.onLimit, via: `${edge.id}:limit` };
    await this.failRun(runId, `Loop limit reached (${edge.maxLoops}× ${edge.source} → ${edge.target}).`);
    return null;
  }

  async finish(runId: string, outcome: string) {
    await this.patchRun(runId, { status: 'done', current_node_id: null, finished_at: new Date() });
    await this.event(runId, 'system', 'run_finished', { outcome });
    await this.emit(runId, 'done');
  }

  async failNode(nodeRunId: string, error: string) {
    const nr = await this.db
      .updateTable('node_runs')
      .set({ status: 'failed', error: error.slice(0, 4000), ended_at: new Date() })
      .where('id', '=', nodeRunId)
      .where('status', 'in', ['queued', 'running'])
      .returning(['run_id', 'node_id'])
      .executeTakeFirst();
    if (nr) await this.failRun(nr.run_id, error, nodeRunId);
  }

  async failRun(runId: string, error: string, nodeRunId: string | null = null) {
    const r = await this.db
      .updateTable('workflow_runs')
      .set({ status: 'failed', error: error.slice(0, 4000), updated_at: new Date() })
      .where('id', '=', runId)
      .where('status', 'in', ['running', 'waiting'])
      .executeTakeFirst();
    if (Number(r.numUpdatedRows)) {
      await this.event(runId, 'system', 'run_failed', { error }, nodeRunId);
      await this.emit(runId, 'failed');
    }
  }

  // ---------- user actions ----------

  private async currentNodeRun(runId: string, types: NodeType[]): Promise<NodeRun> {
    const nr = await this.db
      .selectFrom('node_runs')
      .selectAll()
      .where('run_id', '=', runId)
      .where('status', '=', 'waiting')
      .where('node_type', 'in', types)
      .orderBy('seq', 'desc')
      .executeTakeFirst();
    if (!nr) throw new RunConflict('Nothing is waiting for you on this run.');
    return nr;
  }

  async gate(runId: string, a: GateAction) {
    const nr = await this.currentNodeRun(runId, ['human.gate']);
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    const cfg = this.node(run, nr.node_id).config as { editable?: string[] };
    for (const [name, content] of Object.entries(a.edits ?? {})) {
      if (!(cfg.editable ?? []).includes(name)) throw new Error(`"${name}" is not editable at this step`);
      const latest = await this.latestArtifact(runId, name);
      if (latest?.content === content) continue;
      await this.saveArtifact(runId, nr.id, name, content, 'user');
    }
    if (a.action === 'changes' && !a.feedback?.trim()) throw new Error('Say what should change when sending it back.');
    await this.complete(nr.id, a.action, { feedback: a.feedback ?? null, edited: Object.keys(a.edits ?? {}) }, 'user', ['waiting']);
  }

  async evaluate(runId: string, a: EvaluateAction) {
    const nr = await this.currentNodeRun(runId, ['evaluate']);
    await this.db
      .insertInto('evaluations')
      .values({ run_id: runId, scores: JSON.stringify(a.scores), note: a.note ?? null })
      .onConflict(oc => oc.column('run_id').doUpdateSet({ scores: JSON.stringify(a.scores), note: a.note ?? null }))
      .execute();
    await this.complete(nr.id, 'end', { scores: a.scores, note: a.note ?? null }, 'user', ['waiting']);
  }

  /** A confirm node's draft is ready: the node and the run wait for the user. */
  async awaitConfirmation(nodeRunId: string, output: Record<string, unknown>, patch: NodeRunUpdate) {
    const nr = await this.db
      .updateTable('node_runs')
      .set({ ...patch, status: 'waiting', output: JSON.stringify(output) })
      .where('id', '=', nodeRunId)
      .where('status', '=', 'running')
      .returning(['run_id', 'node_id'])
      .executeTakeFirst();
    if (!nr) return;
    await this.patchRun(nr.run_id, { status: 'waiting' });
    await this.event(nr.run_id, 'job', 'waiting_for_confirmation', { node: nr.node_id }, nodeRunId);
    await this.emit(nr.run_id, 'waiting');
  }

  /**
   * The only places that write outside this machine: a Jira comment, or push + Bitbucket PR. They run only on an
   * explicit confirmation carrying the exact text the user saw. The node is claimed first so a double click cannot
   * post twice; on failure it goes back to waiting with the error shown.
   */
  async confirm(runId: string, a: ConfirmAction): Promise<Record<string, unknown>> {
    const nr = await this.currentNodeRun(runId, [...CONFIRM_NODE_TYPES]);
    if (a.action === 'skip') {
      await this.complete(nr.id, 'skipped', { note: a.note ?? null }, 'user', ['waiting']);
      return { skipped: true };
    }
    const claimed = await this.db.updateTable('node_runs').set({ status: 'running', error: null }).where('id', '=', nr.id).where('status', '=', 'waiting').executeTakeFirst();
    if (!Number(claimed.numUpdatedRows)) throw new RunConflict('This step is already being confirmed.');
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    const node = this.node(run, nr.node_id);
    const outputName = (node.config as { output?: string }).output ?? (nr.node_type === 'git.pr' ? 'pr_description' : 'jira_comment');
    try {
      if ((await this.latestArtifact(runId, outputName))?.content !== a.text) await this.saveArtifact(runId, nr.id, outputName, a.text, 'user');
      const result = nr.node_type === 'jira.comment' ? await this.postJiraComment(run, a.text) : await this.openPullRequest(run, nr, a);
      await this.event(runId, 'user', nr.node_type === 'jira.comment' ? 'jira_comment_posted' : 'pull_request_opened', result, nr.id);
      await this.complete(nr.id, nr.node_type === 'jira.comment' ? 'posted' : 'opened', { ...((nr.output ?? {}) as object), ...result }, 'user', ['running']);
      return result;
    } catch (err) {
      const message = String((err as Error).message ?? err).slice(0, 2000);
      await this.db.updateTable('node_runs').set({ status: 'waiting', error: message }).where('id', '=', nr.id).where('status', '=', 'running').execute();
      await this.event(runId, 'user', 'confirm_failed', { error: message }, nr.id);
      throw err;
    }
  }

  private async postJiraComment(run: WorkflowRun, text: string) {
    const task = await this.tasks.getTask(run.task_id);
    if (!task?.key) throw new Error('This task has no Jira key.');
    const client = await this.tasks.jiraClient();
    if (!client) throw new Error('Jira is not configured (JIRA_* in .env).');
    const { id } = await client.addComment(task.key, text);
    return { commentId: id, issueKey: task.key };
  }

  private async openPullRequest(run: WorkflowRun, nr: NodeRun, a: Extract<ConfirmAction, { action: 'confirm' }>) {
    if (!run.worktree_path || !run.repo_path || !run.branch || !run.base_ref) throw new Error('This run has no worktree/branch yet.');
    const out = (nr.output ?? {}) as { title?: string; target?: string };
    const task = await this.tasks.getTask(run.task_id);
    const entry = this.repos.entry(task?.project ?? null);
    const remote = entry?.remote ?? (run.base_ref.includes('/') ? run.base_ref.split('/')[0]! : 'origin');
    const target = a.targetBranch ?? out.target ?? run.base_ref.replace(/^[^/]+\//, '');
    const title = a.title ?? out.title ?? `${task?.key ?? ''}`;
    const commits = (await diffInfo(run.worktree_path, run.base_ref)).commits;
    if (!commits.length) throw new Error(`Nothing is committed on ${run.branch} compared with ${run.base_ref}; there is nothing to open a PR for.`);
    const repo = entry?.bitbucket
      ? { workspace: entry.bitbucket.split('/')[0]!, slug: entry.bitbucket.split('/')[1]! }
      : parseBitbucketRemote(await remoteUrl(run.repo_path, remote));
    if (!repo) throw new Error(`Remote "${remote}" is not a Bitbucket repository; set "bitbucket": "workspace/repo" for this project in config/repos.json.`);
    const email = this.config.BITBUCKET_EMAIL ?? this.config.JIRA_EMAIL;
    if (!this.config.BITBUCKET_API_TOKEN || !email) {
      throw new Error('Bitbucket is not configured: set BITBUCKET_API_TOKEN (and BITBUCKET_EMAIL if it differs from JIRA_EMAIL) in .env.');
    }
    const pushLog = await pushBranch(run.worktree_path, remote, run.branch).catch(e => {
      throw new Error(`git push failed: ${String((e as { stderr?: string }).stderr ?? (e as Error).message).trim().slice(0, 800)}`);
    });
    const pr = await new BitbucketClient({ baseUrl: this.config.BITBUCKET_API_URL, email, token: this.config.BITBUCKET_API_TOKEN }).openPullRequest({
      ...repo, title, description: a.text, source: run.branch, destination: target,
    });
    return { prUrl: pr.url, prId: pr.id, existingPr: pr.existing, target, pushed: run.branch, commits: commits.length, pushLog: pushLog.slice(0, 500) };
  }

  /** Re-runs the step that failed (new attempt of the same node). */
  async retry(runId: string) {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (run.status !== 'failed') throw new RunConflict(`The run is ${run.status}, not failed.`);
    const last = await this.db.selectFrom('node_runs').selectAll().where('run_id', '=', runId).orderBy('seq', 'desc').executeTakeFirstOrThrow();
    await this.event(runId, 'user', 'retry', { node: last.node_id });
    await this.enqueue(runId, last.node_id, last.via_edge, (last.input ?? {}) as Record<string, unknown>);
  }

  async cancel(runId: string) {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (!ACTIVE.includes(run.status as (typeof ACTIVE)[number])) throw new RunConflict(`The run is already ${run.status}.`);
    const live = await this.db.selectFrom('node_runs').select(['id', 'process_id']).where('run_id', '=', runId).where('status', 'in', ['queued', 'running', 'waiting']).execute();
    for (const n of live) if (isAlive(n.process_id)) stopProcess(n.process_id);
    await this.db.updateTable('node_runs').set({ status: 'cancelled', ended_at: new Date() }).where('run_id', '=', runId).where('status', 'in', ['queued', 'running', 'waiting']).execute();
    await this.patchRun(runId, { status: 'cancelled', current_node_id: null, finished_at: new Date() });
    await this.event(runId, 'user', 'run_cancelled', { stoppedAgents: live.filter(n => n.process_id).length });
  }

  // ---------- artifacts + worktree ----------

  async saveArtifact(runId: string, nodeRunId: string | null, name: string, content: string, author: 'ai' | 'user') {
    const latest = await this.latestArtifact(runId, name);
    await this.db
      .insertInto('artifacts')
      .values({ run_id: runId, node_run_id: nodeRunId, name, version: (latest?.version ?? 0) + 1, author, content })
      .execute();
  }

  async latestArtifact(runId: string, name: string) {
    return this.db.selectFrom('artifacts').selectAll().where('run_id', '=', runId).where('name', '=', name).orderBy('version', 'desc').executeTakeFirst();
  }

  async latestArtifacts(runId: string): Promise<Record<string, string>> {
    const rows = await this.db
      .selectFrom('artifacts')
      .select(['name', 'content'])
      .distinctOn('name')
      .where('run_id', '=', runId)
      .orderBy('name')
      .orderBy('version', 'desc')
      .execute();
    return Object.fromEntries(rows.map(r => [r.name, r.content]));
  }

  /** The run's worktree on branch ot/<KEY>, created from the project's base branch the first time a node needs code. */
  async ensureRunWorktree(runId: string): Promise<{ worktree: string; repoPath: string; baseRef: string; branch: string }> {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (run.worktree_path && run.repo_path && run.base_ref && run.branch) {
      const { path } = await ensureWorktree(run.repo_path, run.branch, dataDir(this.config), run.base_ref);
      return { worktree: path, repoPath: run.repo_path, baseRef: run.base_ref, branch: run.branch };
    }
    const task = await this.tasks.getTask(run.task_id);
    const entry = this.repos.entry(task?.project ?? null);
    if (!entry) throw new Error(`No local repo is mapped for project ${task?.project ?? '(none)'}. Add it to config/repos.json (or in the run page), then Retry.`);
    const baseRef = await resolveBaseRef(entry.path, entry.base);
    const fetched = await fetchBase(entry.path, baseRef);
    const branch = run.branch ?? `ot/${task?.key ?? run.id.slice(0, 8)}`;
    const { path, created } = await ensureWorktree(entry.path, branch, dataDir(this.config), baseRef);
    await this.patchRun(runId, { repo_path: entry.path, base_ref: baseRef, branch, worktree_path: path });
    await this.event(runId, 'system', created ? 'worktree_created' : 'worktree_reused', { path, branch, baseRef, fetched });
    return { worktree: path, repoPath: entry.path, baseRef, branch };
  }

  // ---------- reads ----------

  async listRuns(status?: string): Promise<WorkflowRunList> {
    let q = this.baseQuery().orderBy('r.updated_at', 'desc').limit(300);
    if (status && status !== 'all') q = q.where('r.status', '=', status as never);
    const rows = await q.execute();
    const counts = await this.db.selectFrom('workflow_runs').select(['status', sql<number>`count(*)::int`.as('n')]).groupBy('status').execute();
    return { runs: rows.map(r => this.toDto(r)), counts: Object.fromEntries(counts.map(c => [c.status, c.n])) };
  }

  async getRun(id: string): Promise<WorkflowRunDto | null> {
    const r = await this.baseQuery().where('r.id', '=', id).executeTakeFirst();
    return r ? this.toDto(r) : null;
  }

  async getRunDetail(id: string): Promise<WorkflowRunDetail | null> {
    const base = await this.baseQuery().where('r.id', '=', id).executeTakeFirst();
    if (!base) return null;
    const dto = this.toDto(base);
    const [task, nodeRuns, artifacts, events, evaluation] = await Promise.all([
      this.tasks.getTask(dto.task.id),
      this.db.selectFrom('node_runs').selectAll().where('run_id', '=', id).orderBy('seq').execute(),
      this.db.selectFrom('artifacts').selectAll().where('run_id', '=', id).orderBy('name').orderBy('version', 'desc').execute(),
      this.db.selectFrom('run_events').selectAll().where('run_id', '=', id).orderBy('id', 'desc').limit(300).execute(),
      this.db.selectFrom('evaluations').selectAll().where('run_id', '=', id).executeTakeFirst(),
    ]);
    return {
      ...dto,
      task: task!,
      workflow: base.workflow_snapshot as WorkflowDefinition,
      mappedRepo: this.repos.forProject(task?.project ?? null),
      nodeRuns: nodeRuns.map(n => ({
        id: n.id, seq: n.seq, nodeId: n.node_id, nodeType: n.node_type, attempt: n.attempt, status: n.status, port: n.port,
        input: (n.input ?? {}) as Record<string, unknown>, output: (n.output ?? {}) as Record<string, unknown>, error: n.error,
        costUsd: n.cost_usd, numTurns: n.num_turns, skillHash: n.skill_hash, agentSessionId: n.agent_session_id,
        startedAt: iso(n.started_at), endedAt: iso(n.ended_at), waitingMs: n.waiting_ms == null ? null : Number(n.waiting_ms),
      })),
      artifacts: artifacts.map(
        (a): ArtifactDto => ({ id: a.id, name: a.name, version: a.version, author: a.author, content: a.content, nodeRunId: a.node_run_id, createdAt: a.created_at.toISOString() }),
      ),
      events: events.map(e => ({ id: String(e.id), actor: e.actor, action: e.action, detail: (e.detail ?? {}) as Record<string, unknown>, createdAt: e.created_at.toISOString() })),
      evaluation: evaluation ? { scores: evaluation.scores as Record<string, number>, note: evaluation.note } : null,
    };
  }

  private baseQuery() {
    return this.db
      .selectFrom('workflow_runs as r')
      .innerJoin('tasks as t', 't.id', 'r.task_id')
      .innerJoin('workspaces as w', 'w.id', 't.workspace_id')
      .innerJoin('sources as s', 's.id', 't.source_id')
      .selectAll('r')
      .select(eb => [
        't.id as t_id', 't.key as t_key', 't.title as t_title', 't.status as t_status', 't.status_category as t_status_category',
        't.priority as t_priority', 't.assignee as t_assignee', 't.project as t_project', 't.type as t_type', 't.labels as t_labels',
        't.url as t_url', 't.due_at as t_due_at', 't.updated_at_source as t_updated', 't.archived_at as t_archived_at',
        'w.slug as t_workspace', 's.kind as t_source',
        eb.selectFrom('node_runs').select(sql<number>`coalesce(sum(cost_usd), 0)::float`.as('c')).whereRef('node_runs.run_id', '=', 'r.id').as('cost'),
      ]);
  }

  private toDto(r: any): WorkflowRunDto {
    const def = r.workflow_snapshot as WorkflowDefinition;
    return {
      id: r.id, status: r.status, workflowId: r.workflow_id, workflowHash: r.workflow_hash, trigger: r.trigger,
      task: {
        id: r.t_id, workspace: r.t_workspace, source: r.t_source, key: r.t_key, title: r.t_title, status: r.t_status,
        statusCategory: r.t_status_category, priority: r.t_priority, assignee: r.t_assignee, project: r.t_project, type: r.t_type,
        labels: r.t_labels ?? [], url: r.t_url, dueAt: r.t_due_at ? new Date(r.t_due_at).toISOString().slice(0, 10) : null,
        updatedAt: iso(r.t_updated), archived: r.t_archived_at != null,
      },
      currentNodeId: r.current_node_id,
      currentNodeLabel: def.nodes.find(n => n.id === r.current_node_id)?.label ?? null,
      repoPath: r.repo_path, baseRef: r.base_ref, branch: r.branch, worktreePath: r.worktree_path, error: r.error,
      costUsd: Number(r.cost ?? 0),
      vars: (r.vars ?? {}) as Record<string, unknown>,
      createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, finishedAt: iso(r.finished_at),
    };
  }
}
