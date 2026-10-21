import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TasksService } from './tasks.service';

test('assertLocal throws with updated message for synced tasks', async () => {
  const db: any = {
    selectFrom: () => ({
      innerJoin: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => ({ id: 't-1', kind: 'github' }),
          }),
        }),
      }),
    }),
  };

  const service = new TasksService(db, {} as any, {} as any, {} as any);

  await assert.rejects(
    () => service.updateLocal('t-1', { title: 'New title' }),
    (err: Error) => {
      assert.equal(err.message, 'Only local tasks can be changed here; synced tasks are read-only.');
      return true;
    },
  );
});

test('ensureDetail dispatches to GitHub when kind is github', async () => {
  let githubSynced = false;
  const db: any = {
    selectFrom: () => ({
      innerJoin: () => ({
        select: () => ({
          where: () => ({
            executeTakeFirst: async () => ({
              id: 't-gh',
              key: '#42',
              project: 'owner/repo',
              external_id: 'owner/repo#42',
              detail_synced_at: null,
              kind: 'github',
            }),
          }),
        }),
      }),
    }),
  };

  const service = new TasksService(db, {} as any, {} as any, {} as any);
  service.syncGithubTaskDetail = async (task: any) => {
    assert.equal(task.key, '#42');
    githubSynced = true;
  };

  await service.ensureDetail('t-gh');
  assert.equal(githubSynced, true);
});

test('list includes githubConfigured and supports source=github filter', async () => {
  let whereClauses: { col: string; op: string; val: any }[] = [];
  const db: any = {
    selectFrom: (table: string) => ({
      innerJoin: () => ({
        innerJoin: () => ({
          selectAll: () => ({
            select: () => {
              const query: any = {
                where: (col: string, op: string, val: any) => {
                  whereClauses.push({ col, op, val });
                  return query;
                },
                orderBy: () => query,
                limit: () => query,
                execute: async () => [],
              };
              return query;
            },
          }),
        }),
      }),
    }),
  };

  const service = new TasksService(db, { GITHUB_TOKEN: 'token' } as any, {} as any, {} as any);
  // Mock internal helpers called by list()
  (service as any).boards = async () => [];
  (service as any).sources = async () => [];

  const res = await service.list({ source: 'github' });
  assert.equal(res.githubConfigured, true);
  assert.ok(whereClauses.some(w => w.col === 's.kind' && w.val === 'github'));
});

test('addGithubSource resolves project and inserts source', async () => {
  let inserted: any = null;
  const db: any = {
    insertInto: () => ({
      values: (val: any) => ({
        onConflict: () => ({
          returning: () => ({
            executeTakeFirstOrThrow: async () => {
              inserted = val;
              return { id: 'src-123', project_id: val.project_id, last_synced_at: null };
            },
          }),
        }),
      }),
    }),
  };

  const projects: any = {
    get: async (slug: string) => (slug === 'my-proj' ? { id: 'p-1', slug: 'my-proj' } : null),
  };

  const service = new TasksService(db, {} as any, {} as any, projects);
  const res = await service.addGithubSource({
    projectSlug: 'my-proj',
    repo: 'owner/repo',
    labels: ['tesserax'],
  });

  assert.equal(res.id, 'src-123');
  assert.equal(inserted.project_id, 'p-1');
  assert.equal(inserted.name, 'owner/repo');
});

test('removeGithubSource deletes the source (tasks cascade)', async () => {
  const calls: string[] = [];
  const db: any = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => ({ id: 'src-gh', kind: 'github' }),
        }),
      }),
    }),
    deleteFrom: (table: string) => ({
      where: () => ({
        execute: async () => {
          calls.push(`delete_${table}`);
        },
      }),
    }),
  };

  const service = new TasksService(db, {} as any, {} as any, {} as any);
  await service.removeGithubSource('src-gh');

  assert.deepEqual(calls, ['delete_sources']);
});

test('removeGithubSource throws on non-existent or non-github source', async () => {
  const db: any = {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          executeTakeFirst: async () => null,
        }),
      }),
    }),
  };

  const service = new TasksService(db, {} as any, {} as any, {} as any);
  await assert.rejects(() => service.removeGithubSource('unknown'), /Source not found/);
});

test('listGithubSources formats rows into GithubSourceItem shape', async () => {
  const db: any = {
    selectFrom: () => ({
      leftJoin: () => ({
        select: () => ({
          where: () => ({
            execute: async () => [
              {
                id: 'src-1',
                name: 'owner/repo',
                config: JSON.stringify({ repo: 'owner/repo', labels: ['tesserax'] }),
                last_synced_at: new Date('2026-10-01T12:00:00Z'),
                last_error: null,
                project_slug: 'my-proj',
              },
            ],
          }),
        }),
      }),
    }),
  };

  const service = new TasksService(db, {} as any, {} as any, {} as any);
  const items = await service.listGithubSources();

  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, 'src-1');
  assert.equal(items[0]!.name, 'owner/repo');
  assert.deepEqual(items[0]!.config, { repo: 'owner/repo', labels: ['tesserax'] });
  assert.equal(items[0]!.last_synced_at, '2026-10-01T12:00:00.000Z');
  assert.equal(items[0]!.project_slug, 'my-proj');
});
