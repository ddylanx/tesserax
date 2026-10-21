import { strict as assert } from 'node:assert';
import { beforeEach, test } from 'node:test';
import type { Db } from '@tesserax/db';
import { runGithubSync, ensureGithubSource } from './github-sync.job';
import { _resetTokenCache } from '../github/token';

interface TaskRow {
  id: string;
  source_id: string;
  project_id: string;
  external_id: string;
  key: string;
  project: string;
  title: string;
  description: string | null;
  status: string;
  status_category: string;
  labels: string[];
  assignee: string | null;
  sprint: string | null;
  url: string;
  synced_at: Date;
  archived_at: Date | null;
  detail_synced_at: Date | null;
  updated_at_source: string;
  comments?: string;
}

interface SourceRow {
  id: string;
  project_id: string;
  kind: string;
  name: string;
  config: string;
  last_synced_at: Date | null;
  last_error: string | null;
}

function createMockDb() {
  const sources: SourceRow[] = [];
  const tasks: TaskRow[] = [];
  let idSeq = 1;

  const db: any = {
    _sources: sources,
    _tasks: tasks,

    selectFrom(table: string) {
      if (table === 'sources') {
        return {
          selectAll() {
            return {
              where(col: string, op: string, val: any) {
                return {
                  execute: async () => sources.filter(s => (s as any)[col] === val),
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected selectFrom(${table})`);
    },

    insertInto(table: string) {
      if (table === 'sources') {
        return {
          values(val: any) {
            return {
              onConflict(_oc: any) {
                return {
                  returning(_cols: any) {
                    return {
                      executeTakeFirstOrThrow: async () => {
                        let existing = sources.find(
                          s => s.project_id === val.project_id && s.kind === val.kind && s.name === val.name,
                        );
                        if (existing) {
                          existing.config = val.config;
                        } else {
                          existing = {
                            id: `src-${idSeq++}`,
                            project_id: val.project_id,
                            kind: val.kind,
                            name: val.name,
                            config: val.config,
                            last_synced_at: null,
                            last_error: null,
                          };
                          sources.push(existing);
                        }
                        return { id: existing.id, project_id: existing.project_id, last_synced_at: existing.last_synced_at };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'tasks') {
        return {
          values(rows: any[]) {
            return {
              onConflict(oc: any) {
                let conflictCols: string[] = [];
                let updateClause: any = null;
                if (typeof oc === 'function') {
                  const ocBuilder = {
                    columns(cols: string[]) {
                      conflictCols = cols;
                      return {
                        doUpdateSet(updateFnOrObj: any) {
                          if (typeof updateFnOrObj === 'function') {
                            const eb = {
                              ref(col: string) {
                                return { __ref: col };
                              },
                            };
                            updateClause = updateFnOrObj(eb);
                          } else {
                            updateClause = updateFnOrObj;
                          }
                          return this;
                        },
                      };
                    },
                  };
                  oc(ocBuilder);
                }
                assert.deepEqual(conflictCols, ['source_id', 'external_id'], 'onConflict columns must be source_id, external_id');
                assert.ok(updateClause, 'doUpdateSet must be invoked');
                assert.ok('detail_synced_at' in updateClause, 'detail_synced_at must be in doUpdateSet');
                return {
                  returning(cols: any[]) {
                    assert.ok(cols.length > 0, 'returning must be specified');
                    return {
                      execute: async () => {
                        const returned: any[] = [];
                        for (const row of rows) {
                          const existing = tasks.find(
                            t => t.source_id === row.source_id && t.external_id === row.external_id,
                          );
                          if (!existing) {
                            const newId = `task-${idSeq++}`;
                            const created: TaskRow = {
                              id: newId,
                              source_id: row.source_id,
                              project_id: row.project_id,
                              external_id: row.external_id,
                              key: row.key,
                              project: row.project,
                              title: row.title,
                              description: row.description,
                              status: row.status,
                              status_category: row.status_category,
                              labels: row.labels,
                              assignee: row.assignee,
                              sprint: row.sprint,
                              url: row.url,
                              synced_at: row.synced_at,
                              archived_at: null,
                              detail_synced_at: null,
                              updated_at_source: row.updated_at_source,
                            };
                            tasks.push(created);
                            returned.push({
                              id: newId,
                              key: row.key,
                              project: row.project,
                              external_id: row.external_id,
                              detail_synced_at: null,
                              inserted: true,
                            });
                          } else {
                            const changed = existing.updated_at_source !== row.updated_at_source;
                            existing.title = row.title;
                            existing.description = row.description;
                            existing.status = row.status;
                            existing.status_category = row.status_category;
                            existing.labels = row.labels;
                            existing.assignee = row.assignee;
                            existing.sprint = row.sprint;
                            existing.url = row.url;
                            existing.synced_at = row.synced_at;
                            existing.archived_at = null;
                            if (changed) existing.detail_synced_at = null;
                            existing.updated_at_source = row.updated_at_source;
                            returned.push({
                              id: existing.id,
                              key: existing.key,
                              project: existing.project,
                              external_id: existing.external_id,
                              detail_synced_at: existing.detail_synced_at,
                              inserted: false,
                            });
                          }
                        }
                        return returned;
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected insertInto(${table})`);
    },

    updateTable(table: string) {
      if (table === 'sources') {
        return {
          set(updates: any) {
            return {
              where(col: string, op: string, val: any) {
                return {
                  execute: async () => {
                    const src = sources.find(s => (s as any)[col] === val);
                    if (src) Object.assign(src, updates);
                  },
                };
              },
            };
          },
        };
      }

      if (table === 'tasks') {
        return {
          set(updates: any) {
            return {
              where(col1: string, op1: string, val1: any) {
                return {
                  execute: async () => {
                    // Update single task (e.g. comments)
                    const t = tasks.find(item => (item as any)[col1] === val1);
                    if (t) Object.assign(t, updates);
                  },
                  where(col2: string, op2: string, val2: any) {
                    return {
                      where(col3: string, op3: string, val3: any) {
                        return {
                          executeTakeFirst: async () => {
                            // Archive sweep: source_id = val1, synced_at < val2, archived_at is null
                            let num = 0;
                            for (const t of tasks) {
                              if (t.source_id === val1 && t.synced_at < val2 && t.archived_at === null) {
                                t.archived_at = updates.archived_at;
                                num++;
                              }
                            }
                            return { numUpdatedRows: BigInt(num) };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Unexpected updateTable(${table})`);
    },
  };

  return db;
}

beforeEach(() => {
  _resetTokenCache();
});

test('first sync inserts issues matching labels, sets firstSync, and maps fields correctly', async () => {
  const db = createMockDb();
  await ensureGithubSource(db as unknown as Db, {
    projectId: 'proj-1',
    repo: 'owner/repo',
    labels: ['tesserax'],
  });

  const mockFetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('/issues/1/comments')) {
      return Response.json([{ id: 101, user: { login: 'commenter' }, created_at: '2026-10-01T10:00:00Z', body: 'Nice' }]);
    }
    return Response.json(
      [
        {
          number: 1,
          title: 'Dogfood Tesserax',
          body: 'Markdown body',
          state: 'open',
          html_url: 'https://github.com/owner/repo/issues/1',
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
          labels: [{ name: 'tesserax' }],
          assignee: { login: 'dev' },
          milestone: { title: 'M1' },
          user: { login: 'alice' },
        },
        {
          number: 2,
          title: 'PR item',
          body: 'Pull request',
          state: 'open',
          html_url: 'https://github.com/owner/repo/pull/2',
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
          labels: [{ name: 'tesserax' }],
          assignee: null,
          milestone: null,
          user: { login: 'bob' },
          pull_request: {},
        },
      ],
      { headers: { etag: '"etag-v1"' } },
    );
  }) as typeof fetch;

  const results = await runGithubSync(db as unknown as Db, { GITHUB_TOKEN: 'fake-token', GITHUB_API_URL: 'https://api.github.com' } as any, mockFetch);

  assert.equal(results.length, 1);
  assert.equal(results[0]!.upserted, 1); // PR was excluded
  assert.equal(results[0]!.firstSync, true);
  assert.equal(results[0]!.inserted.length, 1);

  // Check task in db
  assert.equal(db._tasks.length, 1);
  const task = db._tasks[0];
  assert.equal(task.key, '#1');
  assert.equal(task.project, 'owner/repo');
  assert.equal(task.external_id, 'owner/repo#1');
  assert.equal(task.title, 'Dogfood Tesserax');
  assert.equal(task.description, 'Markdown body');
  assert.equal(task.status_category, 'todo');
  assert.equal(task.assignee, 'dev');
  assert.equal(task.sprint, 'M1');
  assert.ok(task.comments?.includes('Nice'));
});

test('304 Not Modified does not archive tasks and preserves last_synced_at', async () => {
  const db = createMockDb();
  const source = await ensureGithubSource(db as unknown as Db, {
    projectId: 'proj-1',
    repo: 'owner/repo',
  });
  db._sources[0].config = JSON.stringify({ repo: 'owner/repo', labels: ['tesserax'], etag: '"etag-v1"' });
  db._sources[0].last_synced_at = new Date('2026-10-01T00:00:00Z');

  // Insert an existing task
  db._tasks.push({
    id: 't-1',
    source_id: source.id,
    project_id: 'proj-1',
    external_id: 'owner/repo#1',
    key: '#1',
    project: 'owner/repo',
    title: 'Issue 1',
    description: null,
    status: 'open',
    status_category: 'todo',
    labels: ['tesserax'],
    assignee: null,
    sprint: null,
    url: 'https://github.com/owner/repo/issues/1',
    synced_at: new Date('2026-10-01T00:00:00Z'),
    archived_at: null,
    detail_synced_at: new Date('2026-10-01T00:00:00Z'),
    updated_at_source: '2026-10-01T00:00:00Z',
  });

  const mockFetch = (async () => new Response(null, { status: 304 })) as typeof fetch;

  const results = await runGithubSync(db as unknown as Db, { GITHUB_TOKEN: 'fake-token' } as any, mockFetch);

  assert.equal(results[0]!.upserted, 0);
  assert.equal(results[0]!.archived, 0);
  assert.equal(db._tasks[0].archived_at, null); // Not archived
});

test('closing an issue or losing label archives the task on next sync', async () => {
  const db = createMockDb();
  const source = await ensureGithubSource(db as unknown as Db, {
    projectId: 'proj-1',
    repo: 'owner/repo',
  });
  db._sources[0].last_synced_at = new Date('2026-10-01T00:00:00Z');

  // Existing task in DB from previous sync
  db._tasks.push({
    id: 't-1',
    source_id: source.id,
    project_id: 'proj-1',
    external_id: 'owner/repo#1',
    key: '#1',
    project: 'owner/repo',
    title: 'Issue 1',
    description: null,
    status: 'open',
    status_category: 'todo',
    labels: ['tesserax'],
    assignee: null,
    sprint: null,
    url: 'https://github.com/owner/repo/issues/1',
    synced_at: new Date('2026-10-01T00:00:00Z'), // Old sync time
    archived_at: null,
    detail_synced_at: null,
    updated_at_source: '2026-10-01T00:00:00Z',
  });

  // Next sync returns empty list (issue closed or lost label)
  const mockFetch = (async () => Response.json([], { headers: { etag: '"etag-v2"' } })) as typeof fetch;

  const results = await runGithubSync(db as unknown as Db, { GITHUB_TOKEN: 'fake-token' } as any, mockFetch);

  assert.equal(results[0]!.archived, 1);
  assert.ok(db._tasks[0].archived_at !== null);
});

test('two github sources with issue #1 produce two separate tasks', async () => {
  const db = createMockDb();
  await ensureGithubSource(db as unknown as Db, { projectId: 'proj-1', repo: 'repo-a/app' });
  await ensureGithubSource(db as unknown as Db, { projectId: 'proj-1', repo: 'repo-b/app' });

  const mockFetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    const repo = urlStr.includes('repo-a/app') ? 'repo-a/app' : 'repo-b/app';
    if (urlStr.includes('/comments')) return Response.json([]);
    return Response.json([
      {
        number: 1,
        title: `Issue 1 of ${repo}`,
        body: null,
        state: 'open',
        html_url: `https://github.com/${repo}/issues/1`,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        labels: [{ name: 'tesserax' }],
        assignee: null,
        milestone: null,
        user: null,
      },
    ]);
  }) as typeof fetch;

  const results = await runGithubSync(db as unknown as Db, { GITHUB_TOKEN: 'fake-token' } as any, mockFetch);

  assert.equal(results.length, 2);
  assert.equal(db._tasks.length, 2);
  assert.equal(db._tasks[0].external_id, 'repo-a/app#1');
  assert.equal(db._tasks[1].external_id, 'repo-b/app#1');
});

test('one failing source does not block another source', async () => {
  const db = createMockDb();
  await ensureGithubSource(db as unknown as Db, { projectId: 'proj-1', repo: 'broken/repo' });
  await ensureGithubSource(db as unknown as Db, { projectId: 'proj-1', repo: 'good/repo' });

  const mockFetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('broken/repo')) {
      return new Response(JSON.stringify({ message: 'Repo access denied' }), { status: 403 });
    }
    if (urlStr.includes('/comments')) return Response.json([]);
    return Response.json([
      {
        number: 10,
        title: 'Good issue',
        body: null,
        state: 'open',
        html_url: 'https://github.com/good/repo/issues/10',
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        labels: [{ name: 'tesserax' }],
        assignee: null,
        milestone: null,
        user: null,
      },
    ]);
  }) as typeof fetch;

  const results = await runGithubSync(db as unknown as Db, { GITHUB_TOKEN: 'fake-token' } as any, mockFetch);

  assert.equal(results.length, 2);
  assert.equal(results[0]!.upserted, 0); // Broken failed
  assert.equal(results[1]!.upserted, 1); // Good succeeded
  assert.ok(db._sources[0].last_error?.includes('Repo access denied'));
  assert.equal(db._sources[1].last_error, null);
});

test('end-to-end sync with fake-github HTTP server (AC1, AC2, AC3, AC4)', async () => {
  const { startFakeGithub } = await import('../../../../../scripts/fake-github.mjs');
  const fakeServer = await startFakeGithub(0);
  try {
    const db = createMockDb();
    await ensureGithubSource(db as unknown as Db, {
      projectId: 'proj-1',
      repo: 'owner/repo',
      labels: ['tesserax'],
    });

    const config = {
      GITHUB_TOKEN: 'fake-token',
      GITHUB_API_URL: fakeServer.url,
    } as any;

    // 1. First sync inserts matching issue #1, skips PR #3 and unlabelled #2
    const res1 = await runGithubSync(db as unknown as Db, config);
    assert.equal(res1[0]!.upserted, 1);
    assert.equal(res1[0]!.firstSync, true);
    assert.equal(db._tasks.length, 1);
    assert.equal(db._tasks[0].key, '#1');
    assert.equal(db._tasks[0].external_id, 'owner/repo#1');
    assert.equal(db._tasks[0].title, 'Dogfood Tesserax');
    assert.equal(db._tasks[0].status_category, 'todo');
    assert.equal(db._tasks[0].archived_at, null);

    // 2. Second sync unchanged -> 304, no changes, no archiving
    const res2 = await runGithubSync(db as unknown as Db, config);
    assert.equal(res2[0]!.upserted, 0);
    assert.equal(res2[0]!.archived, 0);
    assert.equal(db._tasks[0].archived_at, null);

    // 3. Update body & updated_at in fake GitHub -> resets detail_synced_at (AC3)
    fakeServer.state.updateBody(1, 'Updated body description');
    const res3 = await runGithubSync(db as unknown as Db, config);
    assert.equal(res3[0]!.upserted, 1);
    assert.equal(db._tasks[0].description, 'Updated body description');

    // 4. Close issue -> archived on next sync (AC4)
    fakeServer.state.closeIssue(1);
    const res4 = await runGithubSync(db as unknown as Db, config);
    assert.equal(res4[0]!.archived, 1);
    assert.ok(db._tasks[0].archived_at !== null);
  } finally {
    await fakeServer.close();
  }
});

test('rate limit 403 with x-ratelimit-remaining=0 sets last_error and does not crash (AC8)', async () => {
  const db = createMockDb();
  await ensureGithubSource(db as unknown as Db, { projectId: 'proj-1', repo: 'rate-limited/repo' });

  const resetTime = Math.floor(Date.now() / 1000) + 120;
  const mockFetch = (async () =>
    new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
      status: 403,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetTime),
      },
    })) as typeof fetch;

  const results = await runGithubSync(db as unknown as Db, { GITHUB_TOKEN: 'fake-token' } as any, mockFetch);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.upserted, 0);
  assert.ok(db._sources[0].last_error?.includes('rate limit exceeded'));
});

test('archive on unlabel through label filter (AC4)', async () => {
  const { startFakeGithub } = await import('../../../../../scripts/fake-github.mjs');
  const fakeServer = await startFakeGithub(0);
  try {
    const db = createMockDb();
    await ensureGithubSource(db as unknown as Db, {
      projectId: 'proj-1',
      repo: 'owner/repo',
      labels: ['tesserax'],
    });

    const config = {
      GITHUB_TOKEN: 'fake-token',
      GITHUB_API_URL: fakeServer.url,
    } as any;

    await runGithubSync(db as unknown as Db, config);
    assert.equal(db._tasks.length, 1);
    assert.equal(db._tasks[0].archived_at, null);

    // Remove the 'tesserax' label from issue #1
    fakeServer.state.removeLabel(1, 'tesserax');

    const res = await runGithubSync(db as unknown as Db, config);
    assert.equal(res[0]!.archived, 1);
    assert.ok(db._tasks[0].archived_at !== null);
  } finally {
    await fakeServer.close();
  }
});

test('truncated listing does not run the archive sweep (Problem 4)', async () => {
  const db = createMockDb();
  const source = await ensureGithubSource(db as unknown as Db, {
    projectId: 'proj-1',
    repo: 'owner/repo',
  });
  db._sources[0].last_synced_at = new Date('2026-10-01T00:00:00Z');

  // Existing task in DB from previous sync
  db._tasks.push({
    id: 't-old',
    source_id: source.id,
    project_id: 'proj-1',
    external_id: 'owner/repo#999',
    key: '#999',
    project: 'owner/repo',
    title: 'Old task on later page',
    description: null,
    status: 'open',
    status_category: 'todo',
    labels: ['tesserax'],
    assignee: null,
    sprint: null,
    url: 'https://github.com/owner/repo/issues/999',
    synced_at: new Date('2026-10-01T00:00:00Z'),
    archived_at: null,
    detail_synced_at: null,
    updated_at_source: '2026-10-01T00:00:00Z',
  });

  // Mock listing that returns 20 pages and sets truncated = true
  let page = 0;
  const mockFetch = (async (url: string | URL | Request) => {
    const urlStr = url.toString();
    if (urlStr.includes('/comments')) return Response.json([]);
    page++;
    return new Response(
      JSON.stringify([{
        number: page,
        title: `Issue ${page}`,
        body: null,
        labels: [{ name: 'tesserax' }],
        state: 'open',
        html_url: `https://github.com/owner/repo/issues/${page}`,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      }]),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          link: `<https://api.github.com/repos/owner/repo/issues?page=${page + 1}>; rel="next"`,
        },
      },
    );
  }) as typeof fetch;

  const results = await runGithubSync(db as unknown as Db, { GITHUB_TOKEN: 'fake-token' } as any, mockFetch);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.truncated, true);
  assert.equal(results[0]!.archived, 0); // Archive sweep must be skipped
  const oldTask = db._tasks.find((t: { id: string }) => t.id === 't-old');
  assert.equal(oldTask?.archived_at, null, 'tasks on later unvisited pages must not be archived');
});
