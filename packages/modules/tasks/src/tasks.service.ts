import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { jiraConfigured, type AppConfig } from '@tesserax/config';
import { randomUUID } from 'node:crypto';
import { keyPrefixOf, type CreateLocalTask, type ProjectDirectory, type TaskDetailDto, type TaskDto, type TaskList, type TaskQuery, type UpdateLocalTask } from '@tesserax/contracts';
import { CONFIG, DB, PROJECT_DIRECTORY, QUEUE, type Queue } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { JiraClient } from './jira/client';
import { JIRA_SYNC_JOB, jiraCredentials, syncTaskDetail } from './jobs/jira-sync.job';

export type NewTasksListener = (taskIds: string[]) => Promise<void>;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class TasksService {
  private newTaskListeners: NewTasksListener[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(QUEUE) private readonly queue: Queue,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PROJECT_DIRECTORY) private readonly projects: ProjectDirectory,
  ) {}

  async list(f: TaskQuery, limit = 500): Promise<TaskList> {
    let q = this.db
      .selectFrom('tasks as t')
      .innerJoin('projects as w', 'w.id', 't.project_id')
      .innerJoin('sources as s', 's.id', 't.source_id')
      .selectAll('t')
      .select(['w.slug as project_slug', 'w.color as project_color', 's.kind as source'])
      .orderBy(sql`case t.status_category when 'in_progress' then 0 when 'todo' then 1 else 2 end`)
      .orderBy('t.updated_at_source', sql`desc nulls last` as never)
      .limit(limit);
    if (f.project) q = q.where('w.slug', '=', f.project);
    if (f.source) q = q.where('s.kind', '=', f.source);
    if (f.statusCategory) q = q.where('t.status_category', '=', f.statusCategory);
    else if (f.includeDone !== '1') q = q.where('t.status_category', '!=', 'done');
    if (f.board) q = q.where('t.project', '=', f.board);
    if (f.includeArchived !== '1') q = q.where('t.archived_at', 'is', null);
    if (f.q) {
      const like = `%${f.q.replace(/[%_\\]/g, '\\$&')}%`;
      q = q.where(eb => eb.or([eb('t.title', 'ilike', like), eb('t.key', 'ilike', like), eb('t.assignee', 'ilike', like)]));
    }
    const rows = await q.execute();

    const boards = await this.db.selectFrom('tasks').select('project').distinct().where('project', 'is not', null).orderBy('project').execute();
    const sources = await this.db
      .selectFrom('sources as s')
      .innerJoin('projects as w', 'w.id', 's.project_id')
      .leftJoin('tasks as t', join => join.onRef('t.source_id', '=', 's.id').on('t.archived_at', 'is', null))
      .select(['s.id', 's.kind', 's.name', 's.last_synced_at', 's.last_error', 'w.slug as project_slug', sql<number>`count(t.id)::int`.as('n')])
      .groupBy(['s.id', 'w.slug'])
      .execute();

    return {
      jiraConfigured: jiraConfigured(this.config),
      boards: boards.map(p => p.project!).filter(Boolean),
      sources: sources.map(s => ({
        id: s.id, projectSlug: s.project_slug, kind: s.kind, name: s.name,
        lastSyncedAt: iso(s.last_synced_at), lastError: s.last_error, taskCount: s.n,
      })),
      tasks: rows.map(r => this.toDto(r)),
    };
  }

  /** Other modules (pipeline) subscribe to issues seen for the first time. */
  onNewTasks(fn: NewTasksListener) {
    this.newTaskListeners.push(fn);
  }

  async notifyNewTasks(taskIds: string[]) {
    for (const fn of this.newTaskListeners) await fn(taskIds);
  }

  jiraClient(): JiraClient | null {
    const creds = jiraCredentials(this.config);
    return creds ? new JiraClient(creds) : null;
  }

  async getTask(id: string): Promise<TaskDetailDto | null> {
    const r = await this.db
      .selectFrom('tasks as t')
      .innerJoin('projects as w', 'w.id', 't.project_id')
      .innerJoin('sources as s', 's.id', 't.source_id')
      .selectAll('t')
      .select(['w.slug as project_slug', 'w.color as project_color', 's.kind as source'])
      .where('t.id', '=', id)
      .executeTakeFirst();
    return r ? this.toDetail(r) : null;
  }

  /** Refreshes comments/attachments from Jira when they are missing (best effort). */
  async ensureDetail(id: string): Promise<void> {
    const t = await this.db.selectFrom('tasks').select(['id', 'key', 'external_id', 'detail_synced_at']).where('id', '=', id).executeTakeFirst();
    const client = this.jiraClient();
    if (!t || t.detail_synced_at || !client) return;
    await syncTaskDetail(this.db, client, t);
  }

  private toDetail(r: any): TaskDetailDto {
    return {
      ...this.toDto(r),
      description: r.description,
      reporter: r.reporter,
      components: r.components ?? [],
      parent: r.parent,
      sprint: r.sprint,
      comments: (r.comments ?? []) as TaskDetailDto['comments'],
      attachments: (r.attachments ?? []) as TaskDetailDto['attachments'],
      createdAt: iso(r.created_at_source),
      review: (r.review ?? null) as TaskDetailDto['review'],
    };
  }

  private toDto(r: any): TaskDto {
    return {
      id: r.id,
      projectSlug: r.project_slug,
      projectColor: r.project_color,
      pinned: r.project_pinned === true,
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
      workplaceId: r.workplace_id ?? null,
    };
  }

  // ---------- local tasks (not from Jira) ----------

  /** The "Local" source of a project, created on first use. */
  private async localSource(projectId: string) {
    return this.db
      .insertInto('sources')
      .values({ project_id: projectId, kind: 'local', name: 'Local', config: JSON.stringify({}) })
      .onConflict(oc => oc.columns(['project_id', 'kind', 'name']).doUpdateSet({ name: 'Local' }))
      .returning(['id', 'project_id'])
      .executeTakeFirstOrThrow();
  }

  /** Keys like C-12 (Company) or P-3 (Personal), or the project's own prefix; used for branch names (tx/C-12). */
  private async nextLocalKey(sourceId: string, prefix: string) {
    const r = await this.db
      .selectFrom('tasks')
      .select(sql<number>`coalesce(max(nullif(regexp_replace(key, '^[A-Z]+-', ''), '')::int), 0)`.as('n'))
      .where('source_id', '=', sourceId)
      .executeTakeFirstOrThrow();
    return `${prefix}-${Number(r.n) + 1}`;
  }

  async createLocal(input: CreateLocalTask): Promise<TaskDetailDto> {
    const project = await this.projects.get(input.projectSlug);
    if (!project) throw new Error(`Project "${input.projectSlug}" not found`);
    const source = await this.localSource(project.id);
    const key = await this.nextLocalKey(source.id, keyPrefixOf(project));
    const row = await this.db
      .insertInto('tasks')
      .values({
        project_id: source.project_id, source_id: source.id, external_id: randomUUID(), key, title: input.title,
        description: input.description ?? null, status: 'To Do', status_category: 'todo', priority: input.priority ?? null,
        project_pinned: true, project: input.project ?? null, type: input.type, labels: input.labels, due_at: input.dueAt ?? null,
        review: input.review ? JSON.stringify(input.review) : null, workplace_id: input.workplaceId ?? null, created_at_source: new Date(), updated_at_source: new Date(),
        raw: JSON.stringify({ local: true }), synced_at: new Date(), detail_synced_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return (await this.getTask(row.id))!;
  }

  /** Moves a task to a project by hand (it stays there); null hands it back to the rules. */
  async moveToProject(id: string, projectId: string | null): Promise<TaskDetailDto> {
    const t = await this.db.selectFrom('tasks').select(['id', 'project', 'source_id']).where('id', '=', id).executeTakeFirst();
    if (!t) throw new Error('Task not found');
    if (projectId) {
      const target = await this.projects.get(projectId);
      if (!target) throw new Error('Project not found');
      await this.db.updateTable('tasks').set({ project_id: target.id, project_pinned: true }).where('id', '=', id).execute();
    } else {
      const target = await this.projects.resolveForTask({ project: t.project, sourceId: t.source_id });
      await this.db.updateTable('tasks').set({ project_id: target.id, project_pinned: false }).where('id', '=', id).execute();
    }
    return (await this.getTask(id))!;
  }

  /** The workplace a task's workflow works in; any task (Jira too: this is our own field, not Jira's). */
  async setWorkplace(id: string, workplaceId: string | null): Promise<TaskDetailDto> {
    const r = await this.db.updateTable('tasks').set({ workplace_id: workplaceId }).where('id', '=', id).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) throw new Error('Task not found');
    return (await this.getTask(id))!;
  }

  private async assertLocal(id: string) {
    const t = await this.db.selectFrom('tasks as t').innerJoin('sources as s', 's.id', 't.source_id').select(['t.id', 's.kind']).where('t.id', '=', id).executeTakeFirst();
    if (!t) throw new Error('Task not found');
    if (t.kind !== 'local') throw new Error('Only local tasks can be changed here; Jira tasks are read-only.');
  }

  async updateLocal(id: string, input: UpdateLocalTask): Promise<TaskDetailDto> {
    await this.assertLocal(id);
    const statusName = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' } as const;
    await this.db
      .updateTable('tasks')
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.project !== undefined ? { project: input.project || null } : {}),
        ...(input.labels !== undefined ? { labels: input.labels } : {}),
        ...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
        ...(input.review !== undefined ? { review: input.review ? JSON.stringify(input.review) : null } : {}),
        ...(input.workplaceId !== undefined ? { workplace_id: input.workplaceId } : {}),
        ...(input.statusCategory ? { status_category: input.statusCategory, status: statusName[input.statusCategory] } : {}),
        updated_at_source: new Date(),
      })
      .where('id', '=', id)
      .execute();
    return (await this.getTask(id))!;
  }

  async deleteLocal(id: string) {
    await this.assertLocal(id);
    await this.db.deleteFrom('tasks').where('id', '=', id).execute();
  }

  async syncNow(): Promise<{ queued: boolean }> {
    if (!jiraConfigured(this.config)) return { queued: false };
    const id = await this.queue.send(JIRA_SYNC_JOB, {}, { singletonKey: `${JIRA_SYNC_JOB}:manual`, singletonSeconds: 10 });
    return { queued: Boolean(id) };
  }
}
