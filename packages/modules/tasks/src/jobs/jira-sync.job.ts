import { sql } from 'kysely';
import type { AppConfig } from '@tesserax/config';
import type { SyncResult } from '@tesserax/contracts';
import type { Db } from '@tesserax/db';
import { JiraClient, type JiraCredentials } from '../jira/client';
import { mapDetail } from '../jira/map';
import { JiraTaskSource } from '../jira/jira-task-source';

export type { SyncResult };
export const JIRA_SYNC_JOB = 'tasks.jira-sync';

export const jiraCredentials = (c: AppConfig): JiraCredentials | null =>
  c.JIRA_BASE_URL && c.JIRA_EMAIL && c.JIRA_API_TOKEN ? { site: c.JIRA_BASE_URL, email: c.JIRA_EMAIL, token: c.JIRA_API_TOKEN } : null;

/** Ensures the sources row for this Jira site, owned by the configured project (JIRA_WORKSPACE); its tasks are then sorted by the project rules. */
export async function ensureJiraSource(db: Db, config: AppConfig, site: string): Promise<{ id: string; project_id: string; last_synced_at: Date | null }> {
  const ws = await db.selectFrom('projects').select('id').where('slug', '=', config.JIRA_WORKSPACE).executeTakeFirstOrThrow();
  return db
    .insertInto('sources')
    .values({ project_id: ws.id, kind: 'jira', name: site, config: JSON.stringify({ site, jql: config.JIRA_JQL ?? null }) })
    .onConflict(oc => oc.columns(['project_id', 'kind', 'name']).doUpdateSet({ config: sql`excluded.config` }))
    .returning(['id', 'project_id', 'last_synced_at'])
    .executeTakeFirstOrThrow() as Promise<{ id: string; project_id: string; last_synced_at: Date | null }>;
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
  const creds = jiraCredentials(config);
  if (!creds) return { upserted: 0, inserted: [], firstSync: false, detailed: 0, archived: 0, truncated: false };
  const client = new JiraClient(creds, fetchFn);
  const source = await ensureJiraSource(db, config, client.site);
  const taskSource = new JiraTaskSource(db, config, fetchFn);
  return taskSource.sync({
    id: source.id,
    kind: 'jira',
    projectId: source.project_id,
    config: { site: client.site, jql: config.JIRA_JQL ?? null },
  });
}
