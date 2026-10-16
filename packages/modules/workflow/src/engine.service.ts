import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { AppConfig } from '@tesserax/config';
import {
  AGENT_EXECUTORS, AI_ENGINES, ENGINE_NODE_TYPES, CONFIRM_NODE_TYPES, HUMAN_NODE_TYPES, canSwitchWorkflow, NODE_PORTS, conditionsMatch, describeCondition, routeWorkflow,
  type ConfirmAction, type ProjectDirectory, type EvaluateAction, type GateAction, type NodeType, type WorkflowDefinition, type WorkflowEdge,
  type WorkflowNode, type WorkflowRunDetail, type WorkflowRunDto, type WorkflowRunList,
} from '@tesserax/contracts';
import { CONFIG, DB, PROJECT_DIRECTORY, QUEUE, WorkContext, createLogger, type Queue } from '@tesserax/core';
import type { Db, NodeRun, NodeRunUpdate, WorkflowRun, WorkflowRunUpdate } from '@tesserax/db';
import { isAlive, stopProcess } from '@tesserax/agent-runtime';
import { TasksService } from '@tesserax/mod-tasks';
import { repoRegistry } from '@tesserax/mod-repos';
import { RoutingStore, WorkflowStore } from './stores';
import { ArtifactService } from './artifact.service';
import { WorkflowQueryService } from './query.service';
import { WorkflowVcsService } from './vcs.service';

const log = createLogger('workflow');

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
  private listeners: RunListener[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly tasks: TasksService,
    readonly artifacts: ArtifactService,
    readonly queries: WorkflowQueryService,
    readonly vcs: WorkflowVcsService,
    @Inject(PROJECT_DIRECTORY) readonly projects: ProjectDirectory,
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

  /** Starts a run; without a workflow id the routing of the task's project picks one. The project must enable the workflow. */
  async startRun(taskId: string, trigger: 'new_issue' | 'manual', requested?: string): Promise<{ runId: string; created: boolean; workflowId: string }> {
    const task = await this.tasks.getTask(taskId);
    if (!task) throw new Error('Task not found');
    const project = await this.projects.get(task.projectSlug);
    if (!project) throw new Error(`Project "${task.projectSlug}" not found`);
    const workflowId = requested || routeWorkflow(project.settings.routing, task);
    if (project.settings.workflows && !project.settings.workflows.includes(workflowId)) {
      throw new Error(`Workflow "${workflowId}" is not enabled in project "${project.name}".`);
    }
    await this.assertWorkplace(task, project);
    const { def, hash, problems } = this.workflows.load(workflowId);
    if (problems.length) throw new Error(`Workflow ${workflowId} is invalid: ${problems.join('; ')}`);
    const triggerNode = def.nodes.find(n => n.type === 'trigger.jira')!;
    const inserted = await this.db
      .insertInto('workflow_runs')
      .values({
        task_id: taskId, project_id: project.id, workflow_id: def.id, workflow_hash: hash, workflow_snapshot: JSON.stringify(def), trigger,
        vars: JSON.stringify({ project: { slug: project.slug, name: project.name, vars: project.settings.vars } }),
        branch: `tx/${(task.key ?? taskId.slice(0, 8)).replace(/[^A-Za-z0-9._-]+/g, '-')}`,
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

  /**
   * A project that lists workplaces only works in those: a workplace picked on the task must be one of them, and a task
   * that would resolve to another one is pointed at the project's first workplace.
   */
  private async assertWorkplace(task: { id: string; project: string | null; workplaceId?: string | null }, project: { name: string; settings: { workplaceIds: string[] } }) {
    const allowed = project.settings.workplaceIds;
    if (!allowed.length) return;
    if (task.workplaceId && !allowed.includes(task.workplaceId)) throw new Error(`Workplace "${task.workplaceId}" is not one of the workplaces of project "${project.name}".`);
    const resolved = repoRegistry.resolve(task);
    if (!task.workplaceId && !(resolved?.workplaceId && allowed.includes(resolved.workplaceId))) await this.tasks.setWorkplace(task.id, allowed[0]!);
  }

  /**
   * Switches a run to another workflow while it has not got past its first step (see canSwitchWorkflow): the run is cancelled
   * (a running agent is stopped) and a new run starts on the chosen workflow.
   */
  async changeWorkflow(runId: string, workflowId: string): Promise<{ runId: string; workflowId: string }> {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (!ACTIVE.includes(run.status as (typeof ACTIVE)[number])) throw new RunConflict(`The run is already ${run.status}.`);
    if (run.workflow_id === workflowId) return { runId, workflowId };
    const steps = await this.db.selectFrom('node_runs').select(['node_type', 'status', 'output']).where('run_id', '=', runId).execute();
    if (!canSwitchWorkflow(run.status, steps.map(n => ({ nodeType: n.node_type, status: n.status, output: n.output as Record<string, unknown> | null })))) {
      throw new RunConflict('This run is past its first step; cancel it and start a new run to use another workflow.');
    }
    const { problems } = this.workflows.load(workflowId);
    if (problems.length) throw new Error(`Workflow ${workflowId} is invalid: ${problems.join('; ')}`);
    await this.cancel(runId);
    await this.event(runId, 'user', 'workflow_changed', { from: run.workflow_id, to: workflowId });
    const next = await this.startRun(run.task_id, 'manual', workflowId);
    return { runId: next.runId, workflowId: next.workflowId };
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
      const result = nr.node_type === 'jira.comment'
        ? await this.vcs.postJiraComment(run, a.text)
        : await this.vcs.openPullRequest(run, nr, a);
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

  /** Re-runs the step that failed (new attempt of the same node). */
  async retry(runId: string) {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (run.status !== 'failed') throw new RunConflict(`The run is ${run.status}, not failed.`);
    const last = await this.db.selectFrom('node_runs').selectAll().where('run_id', '=', runId).orderBy('seq', 'desc').executeTakeFirstOrThrow();
    await this.event(runId, 'user', 'retry', { node: last.node_id });
    await this.enqueue(runId, last.node_id, last.via_edge, (last.input ?? {}) as Record<string, unknown>);
  }

  /**
   * Who does one step in this run only: an engine (AI steps) or an executor (agent.run); null = the workflow's choice.
   * Stored in run vars (`engine` / `executor`, keyed by node id) and read when the step starts, so it also covers a retry.
   */
  async setNodeAgent(runId: string, nodeId: string, agent: string | null) {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    const node = this.graph(run).nodes.find(n => n.id === nodeId);
    if (!node) throw new RunConflict(`No step ${nodeId} in this run.`);
    const key = node.type === 'agent.run' ? 'executor' : (ENGINE_NODE_TYPES as readonly string[]).includes(node.type) ? 'engine' : null;
    if (!key) throw new RunConflict(`“${node.label}” has no agent to choose.`);
    const allowed: readonly string[] = key === 'engine' ? AI_ENGINES : AGENT_EXECUTORS;
    if (agent !== null && !allowed.includes(agent)) throw new RunConflict(`Pick one of: ${allowed.join(', ')}.`);
    const project = run.project_id ? await this.projects.get(run.project_id) : null;
    if (key === 'engine' && agent !== null && project?.settings.engines.allowed && !project.settings.engines.allowed.includes(agent)) {
      throw new RunConflict(`Project "${project.name}" allows only: ${project.settings.engines.allowed.join(', ')}.`);
    }
    const live = await this.db.selectFrom('node_runs').select('id').where('run_id', '=', runId).where('node_id', '=', nodeId).where('status', '=', 'running').executeTakeFirst();
    if (live) throw new RunConflict(`“${node.label}” is running now; change the agent after it ends (e.g. before a retry).`);
    const vars = (run.vars ?? {}) as Record<string, unknown>;
    const map = { ...((vars[key] ?? {}) as Record<string, string>) };
    if (agent === null) delete map[nodeId];
    else map[nodeId] = agent;
    await this.patchRun(runId, { vars: JSON.stringify({ ...vars, [key]: map }) });
    await this.event(runId, 'user', 'agent_changed', { node: nodeId, agent: agent ?? 'workflow default' });
    return { nodeId, agent };
  }

  /**
   * Runs a failed step again: one that failed outright, or ended through its "failed" port and the run now waits at the
   * next gate. The waiting gate after it is dropped (cancelled) and the step gets a new attempt with the same input.
   */
  async rerunNode(runId: string, nodeId: string) {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (run.status !== 'waiting' && run.status !== 'failed') throw new RunConflict(`The run is ${run.status}; a step can be run again when the run waits for you or failed.`);
    const runs = await this.db.selectFrom('node_runs').selectAll().where('run_id', '=', runId).orderBy('seq', 'asc').execute();
    const last = runs.filter(n => n.node_id === nodeId).at(-1);
    const node = this.node(run, nodeId);
    if (!last || !(last.status === 'failed' || (last.status === 'done' && last.port === 'failed'))) throw new RunConflict(`“${node.label}” did not fail, so there is nothing to run again.`);
    const after = runs.filter(n => n.seq > last.seq);
    if (after.some(n => n.status !== 'waiting' || !HUMAN_NODE_TYPES.includes(this.node(run, n.node_id).type))) {
      throw new RunConflict(`The run already went on after “${node.label}”; send it back from the gate instead.`);
    }
    if (after.length) {
      await this.db.updateTable('node_runs').set({ status: 'cancelled', ended_at: new Date() }).where('id', 'in', after.map(n => n.id)).where('status', '=', 'waiting').execute();
    }
    await this.event(runId, 'user', 'retry', { node: nodeId, dropped: after.map(n => n.node_id) });
    await this.enqueue(runId, nodeId, last.via_edge, (last.input ?? {}) as Record<string, unknown>);
  }

  /**
   * Picks the run up again at `nodeId`, also after it was cancelled or finished: the documents it already made (analysis,
   * spec…) and its worktree stay, so nothing before that step is paid for again. Steps still waiting or queued are dropped.
   */
  async runFrom(runId: string, nodeId: string) {
    const run = await this.db.selectFrom('workflow_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (run.status === 'running') throw new RunConflict('A step is running; wait for it or cancel the run first.');
    const node = this.node(run, nodeId);
    if (node.type === 'trigger.jira') throw new RunConflict('Start a new run to begin from the trigger.');
    const cfg = node.config as { inputs?: string[]; show?: string[]; from?: string };
    const needs = [...(cfg.inputs ?? []), ...(cfg.show ?? []), ...(cfg.from ? [cfg.from] : [])];
    const have = await this.latestArtifacts(runId);
    const missing = needs.filter(n => !(n in have));
    if (missing.length) throw new RunConflict(`“${node.label}” needs ${missing.join(', ')}, which this run has not made yet; start from an earlier step.`);
    await this.db.updateTable('node_runs').set({ status: 'cancelled', ended_at: new Date() }).where('run_id', '=', runId).where('status', 'in', ['queued', 'waiting']).execute();
    try {
      await this.patchRun(runId, { status: 'waiting', finished_at: null, error: null });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new RunConflict('This task already has another active run; cancel that one first.');
      throw err;
    }
    await this.event(runId, 'user', 'run_from', { node: nodeId, previously: run.status });
    await this.enqueue(runId, nodeId, null, {});
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

  // ---------- artifacts (delegated) ----------

  saveArtifact(runId: string, nodeRunId: string | null, name: string, content: string, author: 'ai' | 'user') {
    return this.artifacts.saveArtifact(runId, nodeRunId, name, content, author);
  }

  latestArtifact(runId: string, name: string) {
    return this.artifacts.latestArtifact(runId, name);
  }

  latestArtifacts(runId: string): Promise<Record<string, string>> {
    return this.artifacts.latestArtifacts(runId);
  }

  // ---------- worktree (delegated) ----------

  async ensureRunWorktree(runId: string): Promise<{ worktree: string; repoPath: string; baseRef: string; branch: string }> {
    const res = await this.vcs.ensureRunWorktree(runId);
    if (res.created !== undefined) {
      await this.event(runId, 'system', res.created ? 'worktree_created' : 'worktree_reused', {
        path: res.worktree, branch: res.branch, baseRef: res.baseRef, fetched: res.fetched,
      });
    }
    return { worktree: res.worktree, repoPath: res.repoPath, baseRef: res.baseRef, branch: res.branch };
  }

  // ---------- reads (delegated) ----------

  listRuns(status?: string, project?: string): Promise<WorkflowRunList> {
    return this.queries.listRuns(status, project);
  }

  getRun(id: string): Promise<WorkflowRunDto | null> {
    return this.queries.getRun(id);
  }

  getRunDetail(id: string): Promise<WorkflowRunDetail | null> {
    return this.queries.getRunDetail(id);
  }
}
