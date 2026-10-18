import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { AppConfig } from '@tesserax/config';
import type { SyncResult, TaskCommentResult, TaskDetailUpdate, TaskRecord, TaskSource, TaskSourceRecord } from '@tesserax/contracts';
import { CONFIG, createLogger, DB } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { DEFAULT_JQL, JiraClient } from './client';
import { mapDetail, mapIssue } from './map';
import { jiraCredentials } from '../jobs/jira-sync.job';

const log = createLogger('tasks.jira');

@Injectable()
export class JiraTaskSource implements TaskSource {
  readonly kind = 'jira';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sync(source: TaskSourceRecord): Promise<SyncResult> {
    const empty: SyncResult = { upserted: 0, inserted: [], firstSync: false, detailed: 0, archived: 0, truncated: false };
    const creds = jiraCredentials(this.config);
    if (!creds) return empty;
    const client = new JiraClient(creds, this.fetchFn);

    const startedAt = new Date();
    try {
      const sourceRow = await this.db.selectFrom('sources').select(['last_synced_at']).where('id', '=', source.id).executeTakeFirst();
      const firstSync = !sourceRow?.last_synced_at;

      const sprintField = await client.findSprintField().catch(() => null);
      const jql = (source.config as { jql?: string } | null)?.jql ?? this.config.JIRA_JQL ?? DEFAULT_JQL;
      const { issues, truncated } = await client.search(jql, sprintField ? [sprintField] : []);
      const inserted: string[] = [];
      const needDetail: { id: string; key: string | null; external_id: string }[] = [];
      for (let i = 0; i < issues.length; i += 200) {
        const rows = issues.slice(i, i + 200).map(issue => {
          const m = mapIssue(issue, sprintField);
          return {
            ...m,
            project_id: source.projectId,
            source_id: source.id,
            url: client.browseUrl(m.key),
            synced_at: startedAt,
            archived_at: null,
          };
        });
        const cols = [
          'key', 'title', 'status', 'status_category', 'priority', 'assignee', 'reporter', 'project', 'type', 'labels', 'components',
          'description', 'parent', 'sprint', 'url', 'due_at', 'created_at_source', 'updated_at_source', 'raw', 'synced_at',
        ] as const;
        const result = await this.db
          .insertInto('tasks')
          .values(rows)
          .onConflict(oc =>
            oc.columns(['source_id', 'external_id']).doUpdateSet(eb => ({
              ...Object.fromEntries(cols.map(c => [c, eb.ref(`excluded.${c}`)])),
              archived_at: null,
              // a changed issue needs its comments again
              detail_synced_at: sql`case when tasks.updated_at_source is distinct from excluded.updated_at_source then null else tasks.detail_synced_at end`,
            }) as never),
          )
          .returning(['id', 'key', 'external_id', 'detail_synced_at', sql<boolean>`(xmax = 0)`.as('inserted')])
          .execute();
        for (const r of result) {
          if (r.inserted) inserted.push(r.id);
          if (!r.detail_synced_at) needDetail.push(r);
        }
      }

      // Comments + attachments only for new or changed issues, 4 at a time.
      let detailed = 0;
      for (let i = 0; i < needDetail.length; i += 4) {
        await Promise.all(
          needDetail.slice(i, i + 4).map(t =>
            this.fetchDetail({
              id: t.id,
              key: t.key,
              externalId: t.external_id,
              sourceId: source.id,
              url: null,
            }).then(
              () => detailed++,
              err => log.warn({ key: t.key, err: (err as Error).message }, 'issue detail failed'),
            ),
          ),
        );
      }

      // Issues the query no longer returns (reassigned, older than the window) are archived, not deleted.
      const archived = await this.db
        .updateTable('tasks')
        .set({ archived_at: startedAt })
        .where('source_id', '=', source.id)
        .where('synced_at', '<', startedAt)
        .where('archived_at', 'is', null)
        .executeTakeFirst();
      await this.db.updateTable('sources').set({ last_synced_at: startedAt, last_error: null }).where('id', '=', source.id).execute();
      const result: SyncResult = {
        upserted: issues.length,
        inserted,
        firstSync,
        detailed,
        archived: Number(archived.numUpdatedRows),
        truncated,
      };
      log.info({ upserted: result.upserted, new: inserted.length, detailed, archived: result.archived, truncated }, 'jira sync done');
      return result;
    } catch (err) {
      await this.db.updateTable('sources').set({ last_error: String((err as Error).message ?? err).slice(0, 500) }).where('id', '=', source.id).execute();
      throw err;
    }
  }

  async fetchDetail(task: TaskRecord): Promise<TaskDetailUpdate> {
    const creds = jiraCredentials(this.config);
    if (!creds) throw new Error('Jira is not configured (JIRA_* in .env).');
    const client = new JiraClient(creds, this.fetchFn);
    const issue = await client.getIssue(task.key ?? task.externalId);
    const d = mapDetail(issue);
    await this.db
      .updateTable('tasks')
      .set({
        comments: JSON.stringify(d.comments),
        attachments: JSON.stringify(d.attachments),
        detail_synced_at: new Date(),
      })
      .where('id', '=', task.id)
      .execute();
    return d;
  }

  async postComment(task: TaskRecord, markdown: string): Promise<TaskCommentResult> {
    if (!task.key) throw new Error('This task has no Jira key.');
    const creds = jiraCredentials(this.config);
    if (!creds) throw new Error('Jira is not configured (JIRA_* in .env).');
    const client = new JiraClient(creds, this.fetchFn);
    const comment = await client.addComment(task.key, markdown);
    return {
      id: comment.id,
      url: client.browseUrl(task.key),
    };
  }
}
