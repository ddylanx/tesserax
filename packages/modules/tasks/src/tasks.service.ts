import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { jiraConfigured, type AppConfig } from '@ot/config';
import type { TaskList, TaskQuery } from '@ot/contracts';
import { CONFIG, DB, QUEUE, type Queue } from '@ot/core';
import type { Db } from '@ot/db';
import { JIRA_SYNC_JOB } from './jobs/jira-sync.job';

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class TasksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async list(f: TaskQuery, limit = 500): Promise<TaskList> {
    let q = this.db
      .selectFrom('tasks as t')
      .innerJoin('workspaces as w', 'w.id', 't.workspace_id')
      .innerJoin('sources as s', 's.id', 't.source_id')
      .selectAll('t')
      .select(['w.slug as workspace', 's.kind as source'])
      .orderBy(sql`case t.status_category when 'in_progress' then 0 when 'todo' then 1 else 2 end`)
      .orderBy('t.updated_at_source', sql`desc nulls last` as never)
      .limit(limit);
    if (f.workspace) q = q.where('w.slug', '=', f.workspace);
    if (f.source) q = q.where('s.kind', '=', f.source);
    if (f.statusCategory) q = q.where('t.status_category', '=', f.statusCategory);
    else if (f.includeDone !== '1') q = q.where('t.status_category', '!=', 'done');
    if (f.project) q = q.where('t.project', '=', f.project);
    if (f.includeArchived !== '1') q = q.where('t.archived_at', 'is', null);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where(eb => eb.or([eb('t.title', 'ilike', like), eb('t.key', 'ilike', like), eb('t.assignee', 'ilike', like)]));
    }
    const rows = await q.execute();

    const projects = await this.db.selectFrom('tasks').select('project').distinct().where('project', 'is not', null).orderBy('project').execute();
    const sources = await this.db
      .selectFrom('sources as s')
      .innerJoin('workspaces as w', 'w.id', 's.workspace_id')
      .leftJoin('tasks as t', join => join.onRef('t.source_id', '=', 's.id').on('t.archived_at', 'is', null))
      .select(['s.id', 's.kind', 's.name', 's.last_synced_at', 's.last_error', 'w.slug as workspace', sql<number>`count(t.id)::int`.as('n')])
      .groupBy(['s.id', 'w.slug'])
      .execute();

    return {
      jiraConfigured: jiraConfigured(this.config),
      projects: projects.map(p => p.project!).filter(Boolean),
      sources: sources.map(s => ({
        id: s.id, workspace: s.workspace, kind: s.kind, name: s.name,
        lastSyncedAt: iso(s.last_synced_at), lastError: s.last_error, taskCount: s.n,
      })),
      tasks: rows.map(r => ({
        id: r.id,
        workspace: r.workspace,
        source: r.source,
        key: r.key,
        title: r.title,
        status: r.status,
        statusCategory: r.status_category,
        priority: r.priority,
        assignee: r.assignee,
        project: r.project,
        type: r.type,
        labels: r.labels ?? [],
        url: r.url,
        dueAt: r.due_at ? new Date(r.due_at).toISOString().slice(0, 10) : null,
        updatedAt: iso(r.updated_at_source),
        archived: r.archived_at != null,
      })),
    };
  }

  async syncNow(): Promise<{ queued: boolean }> {
    if (!jiraConfigured(this.config)) return { queued: false };
    const id = await this.queue.send(JIRA_SYNC_JOB, {}, { singletonKey: `${JIRA_SYNC_JOB}:manual`, singletonSeconds: 10 });
    return { queued: Boolean(id) };
  }
}
