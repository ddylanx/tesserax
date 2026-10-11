import { sql } from 'kysely';
import type { AppConfig } from '@ot/config';
import { createLogger } from '@ot/core';
import type { Db } from '@ot/db';
import { DEFAULT_JQL, JiraClient } from '../jira/client';
import { mapIssue } from '../jira/map';

export const JIRA_SYNC_JOB = 'tasks.jira-sync';
const log = createLogger('tasks.jira');

/** Ensures the sources row for this Jira site in the configured workspace. */
export async function ensureJiraSource(db: Db, config: AppConfig): Promise<{ id: string; workspace_id: string }> {
  const ws = await db.selectFrom('workspaces').select('id').where('slug', '=', config.JIRA_WORKSPACE).executeTakeFirstOrThrow();
  const name = new URL(config.JIRA_BASE_URL!).host;
  return db
    .insertInto('sources')
    .values({ workspace_id: ws.id, kind: 'jira', name, config: JSON.stringify({ baseUrl: config.JIRA_BASE_URL, jql: config.JIRA_JQL ?? null }) })
    .onConflict(oc => oc.columns(['workspace_id', 'kind', 'name']).doUpdateSet({ config: sql`excluded.config` }))
    .returning(['id', 'workspace_id'])
    .executeTakeFirstOrThrow();
}

/** Pulls issues from Jira Cloud (read-only) and upserts them into tasks by (source_id, external_id). */
export async function runJiraSync(db: Db, config: AppConfig, fetchFn: typeof fetch = fetch): Promise<{ upserted: number; archived: number }> {
  if (!config.JIRA_BASE_URL || !config.JIRA_EMAIL || !config.JIRA_API_TOKEN) return { upserted: 0, archived: 0 };
  const source = await ensureJiraSource(db, config);
  const client = new JiraClient({ baseUrl: config.JIRA_BASE_URL, email: config.JIRA_EMAIL, apiToken: config.JIRA_API_TOKEN }, fetchFn);
  const startedAt = new Date();
  try {
    const issues = await client.search(config.JIRA_JQL ?? DEFAULT_JQL);
    for (let i = 0; i < issues.length; i += 200) {
      const rows = issues.slice(i, i + 200).map(issue => {
        const m = mapIssue(issue);
        return { ...m, workspace_id: source.workspace_id, source_id: source.id, url: client.browseUrl(m.key), synced_at: startedAt, archived_at: null };
      });
      await db
        .insertInto('tasks')
        .values(rows)
        .onConflict(oc =>
          oc.columns(['source_id', 'external_id']).doUpdateSet(eb => ({
            key: eb.ref('excluded.key'),
            title: eb.ref('excluded.title'),
            status: eb.ref('excluded.status'),
            status_category: eb.ref('excluded.status_category'),
            priority: eb.ref('excluded.priority'),
            assignee: eb.ref('excluded.assignee'),
            project: eb.ref('excluded.project'),
            type: eb.ref('excluded.type'),
            labels: eb.ref('excluded.labels'),
            url: eb.ref('excluded.url'),
            due_at: eb.ref('excluded.due_at'),
            created_at_source: eb.ref('excluded.created_at_source'),
            updated_at_source: eb.ref('excluded.updated_at_source'),
            raw: eb.ref('excluded.raw'),
            synced_at: eb.ref('excluded.synced_at'),
            archived_at: null,
          })),
        )
        .execute();
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
    const result = { upserted: issues.length, archived: Number(archived.numUpdatedRows) };
    log.info(result, 'jira sync done');
    return result;
  } catch (err) {
    await db.updateTable('sources').set({ last_error: String((err as Error).message ?? err).slice(0, 500) }).where('id', '=', source.id).execute();
    throw err;
  }
}
