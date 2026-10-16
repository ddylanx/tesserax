import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  Classification, DecisionInput, FeedbackStats, PipelineEventDto, PipelineList, PipelineRunDetail, PipelineRunDto, RunResult,
} from '@tesserax/contracts';
import { DB, QUEUE, WorkContext, createLogger, type Queue } from '@tesserax/core';
import type { Database, Db, PipelineRun, PipelineRunUpdate, PipelineState } from '@tesserax/db';
import type { Transaction } from 'kysely';
import { TasksService } from '@tesserax/mod-tasks';
import { isAlive, resolveBaseRef, stopProcess } from '@tesserax/agent-runtime';
import { RepoMapStore } from './repo-map';
import { STATE_GROUPS, STEPS, STEP_RETRY, TransitionConflict, canTransition, type StepJobData, type StepName } from './states';

const log = createLogger('pipeline');
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

export type TransitionListener = (run: PipelineRunDto, from: PipelineState, to: PipelineState) => Promise<void> | void;

export interface TransitionArgs {
  from: PipelineState | PipelineState[];
  to: PipelineState;
  actor: 'user' | 'system' | 'job';
  action: string;
  patch?: PipelineRunUpdate;
  detail?: Record<string, unknown>;
  /** Extra writes that must commit together with the transition. */
  within?: (trx: Transaction<Database>, run: PipelineRun) => Promise<void>;
}

@Injectable()
export class PipelineService {
  private listeners: TransitionListener[] = [];
  readonly repos = new RepoMapStore();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    private readonly tasks: TasksService,
  ) {}

  onTransition(fn: TransitionListener) {
    this.listeners.push(fn);
  }

  /** The only way state changes: UPDATE … WHERE state IN (expected), plus an audit event, in one transaction. */
  async transition(runId: string, t: TransitionArgs): Promise<PipelineRun> {
    const from = Array.isArray(t.from) ? t.from : [t.from];
    for (const f of from) if (!canTransition(f, t.to)) throw new Error(`Illegal transition ${f} -> ${t.to}`);
    const { run, prev } = await this.db.transaction().execute(async trx => {
      const before = await trx.selectFrom('pipeline_runs').select('state').where('id', '=', runId).forUpdate().executeTakeFirst();
      const updated = await trx
        .updateTable('pipeline_runs')
        .set({ ...t.patch, state: t.to, updated_at: new Date(), state_changed_at: new Date() })
        .where('id', '=', runId)
        .where('state', 'in', from)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw new TransitionConflict(runId, from, before?.state ?? null);
      if (t.within) await t.within(trx, updated);
      await trx
        .insertInto('pipeline_events')
        .values({
          run_id: runId, from_state: before!.state, to_state: t.to, actor: t.actor, action: t.action,
          detail: JSON.stringify(t.detail ?? {}), correlation_id: WorkContext.correlationId() ?? null,
        })
        .execute();
      return { run: updated, prev: before!.state };
    });
    log.info({ runId, from: prev, to: t.to, action: t.action }, 'pipeline transition');
    if (this.listeners.length) {
      const dto = await this.getRun(runId);
      for (const fn of this.listeners) await Promise.resolve(fn(dto!, prev, t.to)).catch(err => log.warn({ err }, 'transition listener failed'));
    }
    return run;
  }

  /** Event without a state change (step errors, retries, notes). */
  async note(runId: string, actor: string, action: string, detail: Record<string, unknown> = {}) {
    await this.db
      .insertInto('pipeline_events')
      .values({ run_id: runId, actor, action, detail: JSON.stringify(detail), correlation_id: WorkContext.correlationId() ?? null })
      .execute();
  }

  async patch(runId: string, patch: PipelineRunUpdate) {
    await this.db.updateTable('pipeline_runs').set({ ...patch, updated_at: new Date() }).where('id', '=', runId).execute();
  }

  /** Creates a run for a task and starts classification. Returns the existing active run if there is one. */
  async createRun(taskId: string, trigger: 'new_issue' | 'manual'): Promise<{ run: PipelineRunDto; created: boolean }> {
    const inserted = await this.db
      .insertInto('pipeline_runs')
      .values({ task_id: taskId, trigger })
      .returning('id')
      .executeTakeFirst()
      .catch(err => {
        // pipeline_runs_one_active_per_task: the task already has an active run
        if ((err as { code?: string }).code === '23505') return undefined;
        throw err;
      });
    if (!inserted) {
      const existing = await this.db
        .selectFrom('pipeline_runs')
        .select('id')
        .where('task_id', '=', taskId)
        .where('state', 'in', ['new', 'classifying', 'awaiting_decision', 'queued', 'running_playbook', 'awaiting_verify', 'failed'])
        .executeTakeFirstOrThrow();
      return { run: (await this.getRun(existing.id))!, created: false };
    }
    await this.note(inserted.id, trigger === 'manual' ? 'user' : 'system', 'created', { trigger });
    await this.startStep(inserted.id, 'classify', ['new'], 'system', 'classify');
    return { run: (await this.getRun(inserted.id))!, created: true };
  }

  /** Moves the run into the step's state with a new attempt number, then queues the job keyed (run, step, attempt). */
  async startStep(runId: string, step: StepName, from: PipelineState[], actor: 'user' | 'system' | 'job', action: string, patch: PipelineRunUpdate = {}) {
    const run = await this.transition(runId, {
      from, to: STEPS[step].state, actor, action,
      patch: { ...patch, attempt: sql<number>`attempt + 1` as never, error: null, error_step: null },
    });
    const data: StepJobData = { runId, attempt: run.attempt };
    await this.queue.send(STEPS[step].queue, data, { singletonKey: `${runId}:${step}:${run.attempt}`, ...STEP_RETRY });
    await this.note(runId, 'system', 'step_queued', { step, attempt: run.attempt });
  }

  /**
   * Runs a step handler idempotently: skips stale jobs (state or attempt moved on), lets pg-boss retry with backoff,
   * and after the last retry moves the run to failed with the error visible in the inbox.
   */
  async runStep(step: StepName, expected: PipelineState[], data: StepJobData, meta: { retryCount: number; retryLimit: number }, fn: (run: PipelineRun) => Promise<void>) {
    const run = await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', data.runId).executeTakeFirst();
    if (!run || !expected.includes(run.state) || run.attempt !== data.attempt) {
      log.info({ runId: data.runId, step, attempt: data.attempt, state: run?.state, currentAttempt: run?.attempt }, 'stale step job skipped');
      return;
    }
    try {
      await fn(run);
    } catch (err) {
      const message = String((err as Error)?.message ?? err).slice(0, 2000);
      if (err instanceof TransitionConflict) {
        log.info({ runId: run.id, step, message }, 'step lost a race; skipped');
        return;
      }
      const final = meta.retryCount >= meta.retryLimit;
      await this.note(run.id, 'job', final ? 'step_failed' : 'step_error', { step, attempt: data.attempt, retry: meta.retryCount, error: message });
      if (!final) throw err;
      const current = await this.db.selectFrom('pipeline_runs').select('state').where('id', '=', run.id).executeTakeFirst();
      if (current && canTransition(current.state, 'failed')) {
        await this.transition(run.id, { from: current.state, to: 'failed', actor: 'job', action: `${step}_failed`, patch: { error: message, error_step: step }, detail: { error: message } });
      }
    }
  }

  // ---------- user actions ----------

  async reclassify(runId: string) {
    await this.startStep(runId, 'classify', ['awaiting_decision'], 'user', 'reclassify');
  }

  async decide(runId: string, d: DecisionInput, repoPath: string, branch: string) {
    await this.startStep(runId, 'run', ['awaiting_decision'], 'user', 'accept', {
      decision: JSON.stringify({ ...d, repoPath }),
      playbook_id: d.playbookId,
      repo_path: repoPath,
      branch,
    });
  }

  async reject(runId: string, note?: string) {
    await this.transition(runId, { from: 'awaiting_decision', to: 'rejected', actor: 'user', action: 'reject', detail: { note } });
  }

  async retry(runId: string) {
    const run = await this.db.selectFrom('pipeline_runs').select(['state', 'error_step', 'decision']).where('id', '=', runId).executeTakeFirst();
    if (!run) throw new TransitionConflict(runId, ['failed'], null);
    if (run.error_step === 'classify' || !run.decision) await this.startStep(runId, 'classify', ['failed'], 'user', 'retry');
    else await this.startStep(runId, 'run', ['failed'], 'user', 'retry');
  }

  /** awaiting_verify -> verified_true | verified_false, and one labeled feedback row, in one transaction. */
  async verify(runId: string, outcome: boolean, note?: string) {
    await this.transition(runId, {
      from: 'awaiting_verify',
      to: outcome ? 'verified_true' : 'verified_false',
      actor: 'user',
      action: 'verify',
      patch: { verify_note: note ?? null },
      detail: { outcome, note },
      within: async (trx, run) => {
        const task = await trx.selectFrom('tasks').select(['key', 'type']).where('id', '=', run.task_id).executeTakeFirstOrThrow();
        const c = (run.classification ?? null) as Classification | null;
        const d = (run.decision ?? null) as DecisionInput | null;
        const r = (run.result ?? null) as RunResult | null;
        await trx
          .insertInto('pipeline_feedback')
          .values({
            run_id: run.id, task_id: run.task_id, task_key: task.key, issue_type: task.type,
            classification: c ? JSON.stringify(c) : null, classification_engine: run.classification_engine,
            decision: d ? JSON.stringify(d) : null, playbook_id: run.playbook_id,
            classification_accepted: c && d ? c.type === d.type && c.playbook === d.playbookId : null,
            outcome, note: note ?? null, signal: r?.signal ?? null, cost_usd: r?.costUsd ?? null, files_changed: r?.diff?.files ?? null,
          })
          .execute();
      },
    });
  }

  async feedbackStats(): Promise<FeedbackStats> {
    const rows = await this.db.selectFrom('pipeline_feedback').selectAll().orderBy('created_at', 'desc').execute();
    const group = <K extends string | null>(key: (r: (typeof rows)[number]) => K) => {
      const m = new Map<K, typeof rows>();
      for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
      return [...m];
    };
    return {
      total: rows.length,
      verifiedTrue: rows.filter(r => r.outcome).length,
      classificationAccepted: rows.filter(r => r.classification_accepted).length,
      byPlaybook: group(r => r.playbook_id).map(([playbookId, rs]) => ({ playbookId, total: rs.length, verifiedTrue: rs.filter(r => r.outcome).length })),
      byEngine: group(r => r.classification_engine).map(([engine, rs]) => ({ engine, total: rs.length, accepted: rs.filter(r => r.classification_accepted).length })),
      recent: rows.slice(0, 20).map(r => ({ runId: r.run_id, taskKey: r.task_key, playbookId: r.playbook_id, outcome: r.outcome, note: r.note, createdAt: r.created_at.toISOString() })),
    };
  }

  /** The only Jira write. The controller only calls this with an explicit confirmation from the user. */
  async postJiraComment(runId: string, text: string): Promise<{ commentId: string }> {
    const run = await this.getRun(runId);
    if (!run) throw new TransitionConflict(runId, [], null);
    if (!['awaiting_verify', 'verified_true', 'verified_false'].includes(run.state)) {
      throw new TransitionConflict(runId, ['awaiting_verify', 'verified_true', 'verified_false'], run.state);
    }
    const client = this.tasks.jiraClient();
    if (!client) throw new Error('Jira is not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).');
    if (!run.task.key) throw new Error('This task has no Jira key.');
    const { id } = await client.addComment(run.task.key, text);
    await this.patch(runId, { jira_comment_id: id });
    await this.note(runId, 'user', 'jira_comment_posted', { commentId: id, chars: text.length });
    return { commentId: id };
  }

  async rerun(runId: string) {
    await this.startStep(runId, 'run', ['awaiting_verify'], 'user', 'rerun');
  }

  async cancel(runId: string): Promise<PipelineRun> {
    const run = await this.db.selectFrom('pipeline_runs').select(['state', 'process_id']).where('id', '=', runId).executeTakeFirst();
    if (!run) throw new TransitionConflict(runId, [], null);
    const cancelled = await this.transition(runId, { from: run.state, to: 'cancelled', actor: 'user', action: 'cancel' });
    if (run.state === 'running_playbook' && isAlive(run.process_id)) {
      stopProcess(run.process_id);
      await this.note(runId, 'system', 'agent_stopped', { pid: run.process_id });
    }
    return cancelled;
  }

  // ---------- reads ----------

  async listRuns(group?: string): Promise<PipelineList> {
    let q = this.baseQuery().orderBy('r.state_changed_at', 'desc').limit(300);
    const states = group ? STATE_GROUPS[group] : undefined;
    if (states) q = q.where('r.state', 'in', states);
    const rows = await q.execute();
    const counts = await this.db.selectFrom('pipeline_runs').select(['state', sql<number>`count(*)::int`.as('n')]).groupBy('state').execute();
    return { runs: rows.map(r => this.toDto(r)), counts: Object.fromEntries(counts.map(c => [c.state, c.n])) };
  }

  async getRun(id: string): Promise<PipelineRunDto | null> {
    const r = await this.baseQuery().where('r.id', '=', id).executeTakeFirst();
    return r ? this.toDto(r) : null;
  }

  async getRunDetail(id: string): Promise<PipelineRunDetail | null> {
    const run = await this.getRun(id);
    if (!run) return null;
    const task = await this.tasks.getTask(run.task.id);
    const events = await this.db.selectFrom('pipeline_events').selectAll().where('run_id', '=', id).orderBy('id', 'desc').limit(200).execute();
    const session = run.agentSessionId
      ? await this.db
          .selectFrom('agent_sessions')
          .select(['status', 'last_event', 'last_event_at', 'last_tool'])
          .where('session_id', '=', run.agentSessionId)
          .executeTakeFirst()
      : undefined;
    const entry = this.repos.entry(task?.project ?? null);
    const decided = (run.decision as { baseRef?: string } | null)?.baseRef;
    const baseRef = decided ?? (entry ? await resolveBaseRef(entry.path, entry.base).catch(() => null) : null);
    return {
      ...run,
      task: task!,
      mappedRepo: entry?.path ?? null,
      baseRef,
      events: events.map(
        (e): PipelineEventDto => ({
          id: String(e.id), fromState: e.from_state, toState: e.to_state, actor: e.actor, action: e.action,
          detail: (e.detail ?? {}) as Record<string, unknown>, createdAt: e.created_at.toISOString(),
        }),
      ),
      agentSession: session
        ? { status: session.status, lastEvent: session.last_event, lastEventAt: new Date(session.last_event_at).toISOString(), lastTool: session.last_tool }
        : null,
    };
  }

  private baseQuery() {
    return this.db
      .selectFrom('pipeline_runs as r')
      .innerJoin('tasks as t', 't.id', 'r.task_id')
      .innerJoin('projects as w', 'w.id', 't.project_id')
      .innerJoin('sources as s', 's.id', 't.source_id')
      .selectAll('r')
      .select([
        't.id as t_id', 't.key as t_key', 't.title as t_title', 't.status as t_status', 't.status_category as t_status_category',
        't.priority as t_priority', 't.assignee as t_assignee', 't.project as t_project', 't.type as t_type', 't.labels as t_labels',
        't.url as t_url', 't.due_at as t_due_at', 't.updated_at_source as t_updated', 't.archived_at as t_archived_at',
        'w.slug as t_project_slug', 's.kind as t_source',
      ]);
  }

  private toDto(r: any): PipelineRunDto {
    return {
      id: r.id,
      state: r.state,
      trigger: r.trigger,
      attempt: r.attempt,
      task: {
        id: r.t_id, projectSlug: r.t_project_slug, source: r.t_source, key: r.t_key, title: r.t_title, status: r.t_status,
        statusCategory: r.t_status_category, priority: r.t_priority, assignee: r.t_assignee, project: r.t_project, type: r.t_type,
        labels: r.t_labels ?? [], url: r.t_url, dueAt: r.t_due_at ? new Date(r.t_due_at).toISOString().slice(0, 10) : null,
        updatedAt: iso(r.t_updated), archived: r.t_archived_at != null,
      },
      classification: (r.classification as Classification | null) ?? null,
      classificationEngine: r.classification_engine,
      decision: r.decision ?? null,
      playbookId: r.playbook_id,
      repoPath: r.repo_path,
      branch: r.branch,
      worktreePath: r.worktree_path,
      agentSessionId: r.agent_session_id,
      result: (r.result as RunResult | null) ?? null,
      error: r.error,
      errorStep: r.error_step,
      verifyNote: r.verify_note,
      jiraCommentId: r.jira_comment_id,
      createdAt: iso(r.created_at)!,
      stateChangedAt: iso(r.state_changed_at)!,
    };
  }
}
