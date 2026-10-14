import { sql } from 'kysely';
import type { AppConfig } from '@tesserax/config';
import { createLogger } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { DEFAULT_JQL, JiraClient, type JiraCredentials } from '../jira/client';
import { mapDetail, mapIssue } from '../jira/map';

export const JIRA_SYNC_JOB = 'tasks.jira-sync';
const log = createLogger('tasks.jira');

export const jiraCredentials = (c: AppConfig): JiraCredentials | null =>
  c.JIRA_BASE_URL && c.JIRA_EMAIL && c.JIRA_API_TOKEN ? { site: c.JIRA_BASE_URL, email: c.JIRA_EMAIL, token: c.JIRA_API_TOKEN } : null;

/** Ensures the sources row for this Jira site in the configured workspace. */
export async function ensureJiraSource(db: Db, config: AppConfig, site: string): Promise<{ id: string; workspace_id: string; last_synced_at: Date | null }> {
  const ws = await db.selectFrom('workspaces').select('id').where('slug', '=', config.JIRA_WORKSPACE).executeTakeFirstOrThrow();
  return db
    .insertInto('sources')
    .values({ workspace_id: ws.id, kind: 'jira', name: site, config: JSON.stringify({ site, jql: config.JIRA_JQL ?? null }) })
    .onConflict(oc => oc.columns(['workspace_id', 'kind', 'name']).doUpdateSet({ config: sql`excluded.config` }))
    .returning(['id', 'workspace_id', 'last_synced_at'])
    .executeTakeFirstOrThrow() as Promise<{ id: string; workspace_id: string; last_synced_at: Date | null }>;
}

export interface SyncResult {
  upserted: number;
  inserted: string[]; // task ids seen for the first time
  /** First successful sync of this source: everything is "new", so nothing should be auto-started. */
  firstSync: boolean;
  detailed: number;
  archived: number;
  truncated: boolean;
}

/** Fetches comments + attachment metadata for one task (also used on demand before classification). */
export async function syncTaskDetail(db: Db, client: JiraClient, task: { id: string; key: string | null; external_id: string }): Promise<void> {
  const issue = await client.getIssue(task.key ?? task.external_id);
  const d = mapDetail(issue);
  await db
    .updateTable('tasks')
    .set({ comments: JSON.stringify(d.comments), attachments: JSON.stringify(d.attachments), detail_synced_at: new Date() })
    .where('id', '=', task.id)
    .execute();
}

/** Pulls issues from Jira Cloud (read-only) and upserts them into tasks by (source_id, external_id). */
export async function runJiraSync(db: Db, config: AppConfig, fetchFn: typeof fetch = fetch): Promise<SyncResult> {
  const empty: SyncResult = { upserted: 0, inserted: [], firstSync: false, detailed: 0, archived: 0, truncated: false };
  const creds = jiraCredentials(config);
  if (!creds) return empty;
  const client = new JiraClient(creds, fetchFn);
  const source = await ensureJiraSource(db, config, client.site);
  const startedAt = new Date();
  try {
    const sprintField = await client.findSprintField().catch(() => null);
    const { issues, truncated } = await client.search(config.JIRA_JQL ?? DEFAULT_JQL, sprintField ? [sprintField] : []);
    const inserted: string[] = [];
    const needDetail: { id: string; key: string | null; external_id: string }[] = [];
    for (let i = 0; i < issues.length; i += 200) {
      const rows = issues.slice(i, i + 200).map(issue => {
        const m = mapIssue(issue, sprintField);
        return { ...m, workspace_id: source.workspace_id, source_id: source.id, url: client.browseUrl(m.key), synced_at: startedAt, archived_at: null };
      });
      const cols = ['key', 'title', 'status', 'status_category', 'priority', 'assignee', 'reporter', 'project', 'type', 'labels', 'components',
        'description', 'parent', 'sprint', 'url', 'due_at', 'created_at_source', 'updated_at_source', 'raw', 'synced_at'] as const;
      const result = await db
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
          syncTaskDetail(db, client, t).then(
            () => detailed++,
            err => log.warn({ key: t.key, err: (err as Error).message }, 'issue detail failed'),
          ),
        ),
      );
    }
    // Issues the query no longer returns (reassigned, older than the window) are archived, not deleted.
    const archived = await db
      .updateTable('tasks')
      .set({ archived_at: startedAt })
      .where('source_id', '=', source.id)
      .where('synced_at', '<', startedAt)
      .where('archived_at', 'is', null)
      .executeTakeFirst();
    await db.updateTable('sources').set({ last_synced_at: startedAt, last_error: null }).where('id', '=', source.id).execute();
    const result: SyncResult = { upserted: issues.length, inserted, firstSync: !source.last_synced_at, detailed, archived: Number(archived.numUpdatedRows), truncated };
    log.info({ upserted: result.upserted, new: inserted.length, detailed, archived: result.archived, truncated }, 'jira sync done');
    return result;
  } catch (err) {
    await db.updateTable('sources').set({ last_error: String((err as Error).message ?? err).slice(0, 500) }).where('id', '=', source.id).execute();
    throw err;
  }
}
