import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AppConfig } from '@tesserax/config';
import type { SyncResult, TaskRecord, TaskSource, TaskSourceRecord } from '@tesserax/contracts';
import { TaskSourceRegistry } from './task-source.registry';
import { JiraTaskSource } from './jira/jira-task-source';

const fakeConfig = {
  JIRA_BASE_URL: 'https://test.atlassian.net',
  JIRA_EMAIL: 'user@example.com',
  JIRA_API_TOKEN: 'jira-tok',
  JIRA_WORKSPACE: 'default',
} as unknown as AppConfig;

test('TaskSourceRegistry registers and retrieves sources by kind', () => {
  const dummySource: TaskSource = {
    kind: 'jira',
    sync: async () => ({ upserted: 0, inserted: [], firstSync: false, detailed: 0, archived: 0, truncated: false }),
  };
  const dummyGithub: TaskSource = {
    kind: 'github',
    sync: async () => ({ upserted: 0, inserted: [], firstSync: false, detailed: 0, archived: 0, truncated: false }),
  };

  const registry = new TaskSourceRegistry([dummySource, dummyGithub]);
  assert.equal(registry.get('jira'), dummySource);
  assert.equal(registry.get('github'), dummyGithub);
  assert.equal(registry.get('unknown'), null);
  assert.equal(registry.all().length, 2);
});

test('JiraTaskSource.postComment posts comment and returns normalized id and url', async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fakeFetch = (async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    if (url.pathname.endsWith('/myself')) {
      return Response.json({});
    }
    if (init.method === 'POST' && url.pathname.includes('/comment')) {
      return Response.json({ id: '10042' });
    }
    return Response.json({});
  }) as unknown as typeof fetch;

  const jiraSource = new JiraTaskSource({} as any, fakeConfig, fakeFetch);
  const task: TaskRecord = {
    id: 't-1',
    sourceId: 's-1',
    externalId: 'ext-1',
    key: 'PROJ-123',
    url: 'https://test.atlassian.net/browse/PROJ-123',
  };

  const res = await jiraSource.postComment(task, 'Test comment body');
  assert.equal(res.id, '10042');
  assert.equal(res.url, 'https://test.atlassian.net/browse/PROJ-123');

  const commentCall = calls.find(c => c.init.method === 'POST');
  assert.ok(commentCall);
  const body = JSON.parse(String(commentCall.init.body));
  assert.equal(body.body.content[0].content[0].text, 'Test comment body');
});

test('JiraTaskSource.postComment throws descriptive error when task has no key or jira not configured', async () => {
  const jiraSourceNoKey = new JiraTaskSource({} as any, fakeConfig);
  await assert.rejects(
    jiraSourceNoKey.postComment({ id: 't-1', sourceId: 's-1', externalId: 'ext-1', key: null, url: null }, 'hi'),
    /This task has no Jira key/,
  );

  const jiraSourceUnconfigured = new JiraTaskSource({} as any, {} as AppConfig);
  await assert.rejects(
    jiraSourceUnconfigured.postComment({ id: 't-1', sourceId: 's-1', externalId: 'ext-1', key: 'PROJ-1', url: null }, 'hi'),
    /Jira is not configured/,
  );
});

test('Coordinator sync iterates sources and delegates to matching provider', async () => {
  const synced: string[] = [];
  const dummyJira: TaskSource = {
    kind: 'jira',
    sync: async (source: TaskSourceRecord) => {
      synced.push(`jira:${source.id}`);
      return { upserted: 5, inserted: ['t-1'], firstSync: false, detailed: 1, archived: 0, truncated: false };
    },
  };
  const dummyOther: TaskSource = {
    kind: 'other',
    sync: async (source: TaskSourceRecord) => {
      synced.push(`other:${source.id}`);
      return { upserted: 2, inserted: [], firstSync: false, detailed: 0, archived: 0, truncated: false };
    },
  };

  const registry = new TaskSourceRegistry([dummyJira, dummyOther]);

  // Mock DB sources
  const sourcesInDb = [
    { id: 's-jira', kind: 'jira', project_id: 'p-1', config: {} },
    { id: 's-other', kind: 'other', project_id: 'p-2', config: {} },
    { id: 's-unknown', kind: 'unsupported', project_id: 'p-3', config: {} },
  ];

  const results: SyncResult[] = [];
  for (const s of sourcesInDb) {
    const provider = registry.get(s.kind);
    if (!provider) continue;
    const res = await provider.sync({
      id: s.id,
      kind: s.kind,
      projectId: s.project_id,
      config: s.config,
    });
    results.push(res);
  }

  assert.deepEqual(synced, ['jira:s-jira', 'other:s-other']);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.upserted, 5);
  assert.equal(results[1]?.upserted, 2);
});
