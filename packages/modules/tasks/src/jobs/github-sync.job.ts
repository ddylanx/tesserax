import { sql } from 'kysely';
import type { AppConfig } from '@tesserax/config';
import { createLogger } from '@tesserax/core';
import type { Db } from '@tesserax/db';
import { GithubClient, RateLimitError } from '../github/client';
import { mapIssue, mapComments } from '../github/map';
import { resolveGithubToken } from '../github/token';
import type { SyncResult } from './jira-sync.job';

export type { SyncResult } from './jira-sync.job';

export const GITHUB_SYNC_JOB = 'tasks.github-sync';
const log = createLogger('tasks.github');

export interface GithubSourceConfig {
  repo: string;
  labels?: string[];
  assignee?: string | null;
  etag?: string | null;
}

/** Upsert a github source row for the given project+repo combination. */
export async function ensureGithubSource(
  db: Db,
  opts: { projectId: string; repo: string; labels?: string[]; assignee?: string },
): Promise<{ id: string; project_id: string; last_synced_at: Date | null }> {
  return db
    .insertInto('sources')
    .values({
      project_id: opts.projectId,
      kind: 'github',
      name: opts.repo,
      config: JSON.stringify({
        repo: opts.repo,
        labels: opts.labels ?? ['tesserax'],
        assignee: opts.assignee ?? null,
      }),
    })
    .onConflict(oc =>
      oc.columns(['project_id', 'kind', 'name']).doUpdateSet({ config: sql`excluded.config` }),
    )
    .returning(['id', 'project_id', 'last_synced_at'])
    .executeTakeFirstOrThrow() as Promise<{ id: string; project_id: string; last_synced_at: Date | null }>;
}

async function fetchCommentsForTasks(
  db: Db,
  client: GithubClient,
  tasks: { id: string; key: string | null; project: string | null }[],
): Promise<number> {
  let detailed = 0;
  for (let i = 0; i < tasks.length; i += 4) {
    await Promise.all(
      tasks.slice(i, i + 4).map(async t => {
        const repo = t.project ?? '';
        const num = Number((t.key ?? '').replace('#', ''));
        if (!repo || !num) return;
        try {
          const raw = await client.getComments(repo, num);
          await db
            .updateTable('tasks')
            .set({ comments: JSON.stringify(mapComments(raw)), detail_synced_at: new Date() })
            .where('id', '=', t.id)
            .execute();
          detailed++;
        } catch (err) {
          log.warn({ key: t.key, err: (err as Error).message }, 'github comment fetch failed');
        }
      }),
    );
  }
  return detailed;
}

/** Syncs all github sources. Returns one SyncResult per source. */
export async function runGithubSync(
  db: Db,
  config: AppConfig,
  fetchFn: typeof fetch = fetch,
): Promise<SyncResult[]> {
  const sources = await db.selectFrom('sources').selectAll().where('kind', '=', 'github').execute();
  if (!sources.length) return [];

  const results: SyncResult[] = [];

  for (const source of sources) {
    const sourceConfig = (source.config ?? {}) as GithubSourceConfig;
    const repo = sourceConfig.repo;
    if (!repo) continue;

    const token = await resolveGithubToken(config);
    if (!token) {
      await db
        .updateTable('sources')
        .set({ last_error: 'No GitHub token found. Set GITHUB_TOKEN in .env or log in with the gh CLI.' })
        .where('id', '=', source.id)
        .execute();
      results.push({ upserted: 0, inserted: [], firstSync: !source.last_synced_at, detailed: 0, archived: 0, truncated: false });
      continue;
    }

    const client = new GithubClient({ token, apiUrl: config.GITHUB_API_URL }, fetchFn);
    const startedAt = new Date();

    try {
      const res = await client.listIssues({
        repo,
        labels: sourceConfig.labels ?? ['tesserax'],
        assignee: sourceConfig.assignee ?? undefined,
        etag: sourceConfig.etag ?? null,
      });

      if ('notModified' in res) {
        // 304: update last_synced_at but do NOT run the archive sweep
        await db
          .updateTable('sources')
          .set({ last_synced_at: startedAt, last_error: null })
          .where('id', '=', source.id)
          .execute();
        results.push({ upserted: 0, inserted: [], firstSync: false, detailed: 0, archived: 0, truncated: false });
        log.info({ repo }, 'github sync: 304 not modified');
        continue;
      }

      const { issues, etag, truncated } = res;
      const inserted: string[] = [];
      const needDetail: { id: string; key: string | null; project: string | null }[] = [];

      const cols = [
        'key', 'title', 'status', 'status_category', 'priority', 'assignee', 'reporter',
        'project', 'type', 'labels', 'components', 'description', 'parent', 'sprint', 'url',
        'due_at', 'created_at_source', 'updated_at_source', 'raw', 'synced_at',
      ] as const;

      for (let i = 0; i < issues.length; i += 200) {
        const rows = issues.slice(i, i + 200).map(issue => ({
          ...mapIssue(issue, repo),
          project_id: source.project_id,
          source_id: source.id,
          synced_at: startedAt,
          archived_at: null,
        }));

        const result = await db
          .insertInto('tasks')
          .values(rows)
          .onConflict(oc =>
            oc.columns(['source_id', 'external_id']).doUpdateSet(eb => ({
              ...Object.fromEntries(cols.map(c => [c, eb.ref(`excluded.${c}`)])),
              archived_at: null,
              // Reset detail if issue body changed
              detail_synced_at: sql`case when tasks.updated_at_source is distinct from excluded.updated_at_source then null else tasks.detail_synced_at end`,
            }) as never),
          )
          .returning([
            'id', 'key', 'project', 'external_id', 'detail_synced_at',
            sql<boolean>`(xmax = 0)`.as('inserted'),
          ])
          .execute();

        for (const r of result) {
          if (r.inserted) inserted.push(r.id);
          if (!r.detail_synced_at) needDetail.push({ id: r.id, key: r.key, project: r.project });
        }
      }

      const detailed = await fetchCommentsForTasks(db, client, needDetail);

      // Issues that no longer appear in the response are archived, not deleted.
      // If the listing was truncated (hit pagination cap), skip archiving to avoid falsely archiving remaining pages.
      let archivedCount = 0;
      if (!truncated) {
        const archived = await db
          .updateTable('tasks')
          .set({ archived_at: startedAt })
          .where('source_id', '=', source.id)
          .where('synced_at', '<', startedAt)
          .where('archived_at', 'is', null)
          .executeTakeFirst();
        archivedCount = Number(archived.numUpdatedRows);
      }

      // Persist the new ETag for next poll only when full listing was retrieved
      const newConfig: GithubSourceConfig = { ...sourceConfig, etag: truncated ? sourceConfig.etag : etag };
      await db
        .updateTable('sources')
        .set({ last_synced_at: startedAt, last_error: null, config: JSON.stringify(newConfig) })
        .where('id', '=', source.id)
        .execute();

      const syncResult: SyncResult = {
        upserted: issues.length,
        inserted,
        firstSync: !source.last_synced_at,
        detailed,
        archived: archivedCount,
        truncated,
      };
      log.info(
        { repo, upserted: syncResult.upserted, new: inserted.length, detailed, archived: syncResult.archived },
        'github sync done',
      );
      results.push(syncResult);
    } catch (err) {
      const message = String((err as Error).message ?? err).slice(0, 500);
      await db
        .updateTable('sources')
        .set({ last_error: message })
        .where('id', '=', source.id)
        .execute();
      log.warn({ repo, err: message }, 'github sync failed');
      results.push({
        upserted: 0,
        inserted: [],
        firstSync: !source.last_synced_at,
        detailed: 0,
        archived: 0,
        truncated: false,
      });
    }
  }

  return results;
}
