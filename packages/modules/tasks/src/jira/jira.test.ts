import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { JiraClient } from './client';
import { mapIssue } from './map';

test('maps a Jira issue to a task row', () => {
  const m = mapIssue({
    id: '10001', key: 'PAY-412',
    fields: { summary: 'Refund fee', status: { name: 'In Review', statusCategory: { key: 'indeterminate' } }, priority: { name: 'High' }, assignee: null, project: { key: 'PAY' }, labels: ['be'], duedate: '2026-10-20', updated: '2026-10-10T08:00:00.000+0000' },
  });
  assert.equal(m.status_category, 'in_progress');
  assert.equal(m.assignee, null);
  assert.equal(m.project, 'PAY');
  assert.deepEqual(m.labels, ['be']);
});

test('search follows nextPageToken and sends basic auth', async () => {
  const calls: any[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, auth: (init.headers as Record<string, string>).authorization });
    const page = body.nextPageToken ? 2 : 1;
    return new Response(JSON.stringify({ issues: [{ id: String(page), key: `A-${page}`, fields: {} }], ...(page === 1 ? { nextPageToken: 't2', isLast: false } : { isLast: true }) }));
  }) as unknown as typeof fetch;
  const issues = await new JiraClient({ baseUrl: 'https://x.atlassian.net/', email: 'a@b.c', apiToken: 'tok' }, fake).search('project = A');
  assert.deepEqual(issues.map(i => i.key), ['A-1', 'A-2']);
  assert.equal(calls[0].url, 'https://x.atlassian.net/rest/api/3/search/jql');
  assert.equal(calls[0].auth, `Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
  assert.equal(calls[1].body.nextPageToken, 't2');
});
