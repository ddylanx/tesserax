import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type {
  ArtifactDto,
  WorkflowDefinition,
  WorkflowRunDetail,
  WorkflowRunDto,
  WorkflowRunList,
} from '@tesserax/contracts';
import { DB } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { repoRegistry } from '@tesserax/mod-repos';
import { TasksService } from '@tesserax/mod-tasks';

export const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class WorkflowQueryService {

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tasks: TasksService,
  ) {}

  /** `project` is a project slug: only runs of tasks in that project. */
  async listRuns(status?: string, project?: string): Promise<WorkflowRunList> {
    let q = this.baseQuery().orderBy('r.updated_at', 'desc').limit(300);
    if (status && status !== 'all') q = q.where('r.status', '=', status as never);
    if (project) q = q.where('w.slug', '=', project);
    const rows = await q.execute();
    let cq = this.db
      .selectFrom('workflow_runs as r')
      .innerJoin('tasks as t', 't.id', 'r.task_id')
      .innerJoin('projects as w', 'w.id', 't.project_id')
      .select(['r.status', sql<number>`count(*)::int`.as('n')])
      .groupBy('r.status');
    if (project) cq = cq.where('w.slug', '=', project);
    const counts = await cq.execute();
    return {
      runs: rows.map(r => this.toDto(r)),
      counts: Object.fromEntries(counts.map(c => [c.status, c.n])),
    };
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
      ...(() => {
        const w = task ? repoRegistry.resolve(task) : null;
        return {
          mappedRepo: w?.path ?? null,
          workplace: w ? { id: w.workplaceId, brand: w.brand, repository: w.repositoryName, origin: w.origin, path: w.path } : null,
        };
      })(),
      nodeRuns: nodeRuns.map(n => ({
        id: n.id,
        seq: n.seq,
        nodeId: n.node_id,
        nodeType: n.node_type,
        attempt: n.attempt,
        status: n.status,
        port: n.port,
        input: (n.input ?? {}) as Record<string, unknown>,
        output: (n.output ?? {}) as Record<string, unknown>,
        error: n.error,
        costUsd: n.cost_usd,
        numTurns: n.num_turns,
        skillHash: n.skill_hash,
        agentSessionId: n.agent_session_id,
        startedAt: iso(n.started_at),
        endedAt: iso(n.ended_at),
        waitingMs: n.waiting_ms == null ? null : Number(n.waiting_ms),
      })),
      artifacts: artifacts.map(
        (a): ArtifactDto => ({
          id: a.id,
          name: a.name,
          version: a.version,
          author: a.author,
          content: a.content,
          nodeRunId: a.node_run_id,
          createdAt: a.created_at.toISOString(),
        }),
      ),
      events: events.map(e => ({
        id: String(e.id),
        actor: e.actor,
        action: e.action,
        detail: (e.detail ?? {}) as Record<string, unknown>,
        createdAt: e.created_at.toISOString(),
      })),
      evaluation: evaluation ? { scores: evaluation.scores as Record<string, number>, note: evaluation.note } : null,
    };
  }

  baseQuery() {
    return this.db
      .selectFrom('workflow_runs as r')
      .innerJoin('tasks as t', 't.id', 'r.task_id')
      .innerJoin('projects as w', 'w.id', 't.project_id')
      .innerJoin('sources as s', 's.id', 't.source_id')
      .selectAll('r')
      .select(eb => [
        't.id as t_id',
        't.key as t_key',
        't.title as t_title',
        't.status as t_status',
        't.status_category as t_status_category',
        't.priority as t_priority',
        't.assignee as t_assignee',
        't.project as t_project',
        't.type as t_type',
        't.labels as t_labels',
        't.url as t_url',
        't.due_at as t_due_at',
        't.updated_at_source as t_updated',
        't.archived_at as t_archived_at',
        't.project_pinned as t_project_pinned',
        'w.slug as t_project_slug',
        'w.color as t_project_color',
        's.kind as t_source',
        eb.selectFrom('node_runs').select(sql<number>`coalesce(sum(cost_usd), 0)::float`.as('c')).whereRef('node_runs.run_id', '=', 'r.id').as('cost'),
      ]);
  }

  toDto(r: any): WorkflowRunDto {
    const def = r.workflow_snapshot as WorkflowDefinition;
    return {
      id: r.id,
      status: r.status,
      workflowId: r.workflow_id,
      workflowHash: r.workflow_hash,
      trigger: r.trigger,
      task: {
        id: r.t_id,
        projectSlug: r.t_project_slug,
        projectColor: r.t_project_color,
        pinned: r.t_project_pinned === true,
        source: r.t_source,
        key: r.t_key,
        title: r.t_title,
        status: r.t_status,
        statusCategory: r.t_status_category,
        priority: r.t_priority,
        assignee: r.t_assignee,
        project: r.t_project,
        type: r.t_type,
        labels: r.t_labels ?? [],
        url: r.t_url,
        dueAt: r.t_due_at ? new Date(r.t_due_at).toISOString().slice(0, 10) : null,
        updatedAt: iso(r.t_updated),
        archived: r.t_archived_at != null,
      },
      currentNodeId: r.current_node_id,
      currentNodeLabel: def.nodes.find(n => n.id === r.current_node_id)?.label ?? null,
      repoPath: r.repo_path,
      baseRef: r.base_ref,
      branch: r.branch,
      worktreePath: r.worktree_path,
      error: r.error,
      costUsd: Number(r.cost ?? 0),
      vars: (r.vars ?? {}) as Record<string, unknown>,
      createdAt: iso(r.created_at)!,
      updatedAt: iso(r.updated_at)!,
      finishedAt: iso(r.finished_at),
    };
  }
}
