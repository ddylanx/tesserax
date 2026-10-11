import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { adfToText } from './adf';
import { JiraClient, JiraError } from './client';
import { mapDetail, mapIssue, pickSprint } from './map';

test('maps a Jira issue to a task row, with ADF description, components, sprint', () => {
  const m = mapIssue(
    {
      id: '10001', key: 'PAY-412',
      fields: {
        summary: 'Refund fee', status: { name: 'In Review', statusCategory: { key: 'indeterminate' } }, priority: { name: 'High' }, assignee: null,
        project: { key: 'PAY' }, labels: ['be'], components: [{ name: 'api' }], duedate: '2026-10-20',
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Steps:' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'open' }] }] }] }] },
        customfield_10020: [{ name: 'S1', state: 'closed' }, { name: 'S2', state: 'active' }],
      },
    },
    'customfield_10020',
  );
  assert.equal(m.status_category, 'in_progress');
  assert.deepEqual(m.components, ['api']);
  assert.equal(m.description, 'Steps:\n\n- open');
  assert.equal(m.sprint, 'S2');
});

test('pickSprint handles legacy strings', () => {
  assert.equal(pickSprint(['com.atlassian...[id=1,state=ACTIVE,name=Sprint 7,goal=]']), 'Sprint 7');
});

test('mapDetail keeps comment text and attachment metadata only', () => {
  const d = mapDetail({ id: '1', key: 'A-1', fields: {
    comment: { comments: [{ author: { displayName: 'An' }, created: 'x', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'repro on prod' }] }] } }] },
    attachment: [{ filename: 'log.txt', mimeType: 'text/plain', size: 12, content: 'https://secret-download' }],
  } });
  assert.equal(d.comments[0]!.body, 'repro on prod');
  assert.equal(d.attachments[0]!.filename, 'log.txt');
  assert.ok(!JSON.stringify(d).includes('secret-download'));
});

test('adfToText renders code blocks', () => {
  assert.equal(adfToText({ type: 'codeBlock', content: [{ type: 'text', text: 'x()' }] }), '```\nx()\n```\n\n');
});

function fakeJira(handler: (url: URL, init: RequestInit) => Response) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('search follows nextPageToken with GET and basic auth', async () => {
  const { fn, calls } = fakeJira(url => {
    if (url.pathname.endsWith('/myself')) return Response.json({});
    const page = url.searchParams.get('nextPageToken') ? 2 : 1;
    return Response.json({ issues: [{ id: String(page), key: `A-${page}`, fields: {} }], ...(page === 1 ? { nextPageToken: 't2', isLast: false } : { isLast: true }) });
  });
  const { issues } = await new JiraClient({ site: 'https://x.atlassian.net/', email: 'a@b.c', token: 'tok' }, fn).search('project = A');
  assert.deepEqual(issues.map(i => i.key), ['A-1', 'A-2']);
  const search = calls.filter(c => c.url.pathname === '/rest/api/3/search/jql');
  assert.equal(search[0]!.init.method, 'GET');
  assert.equal((search[0]!.init.headers as Record<string, string>).authorization, `Basic ${Buffer.from('a@b.c:tok').toString('base64')}`);
  assert.equal(search[1]!.url.searchParams.get('nextPageToken'), 't2');
});

test('anonymous answer (x-seraph-loginreason) is an auth error, not empty results', async () => {
  const { fn } = fakeJira(() => new Response('{}', { headers: { 'x-seraph-loginreason': 'AUTHENTICATED_FAILED' } }));
  await assert.rejects(new JiraClient({ site: 'x.atlassian.net', email: 'a', token: 'secret-tok' }, fn).search('x'), (e: JiraError) => e.status === 401 && !e.message.includes('secret-tok'));
});

test('falls back to the api.atlassian.com gateway for scoped tokens', async () => {
  const { fn, calls } = fakeJira(url => {
    if (url.host === 'x.atlassian.net' && url.pathname === '/rest/api/3/myself') return new Response('', { status: 401 });
    if (url.pathname === '/_edge/tenant_info') return Response.json({ cloudId: 'cid' });
    if (url.pathname.endsWith('/myself')) return Response.json({});
    return Response.json({ issues: [], isLast: true });
  });
  const c = new JiraClient({ site: 'x.atlassian.net', email: 'a', token: 't' }, fn);
  await c.search('x');
  assert.ok(calls.some(k => k.url.href.startsWith('https://api.atlassian.com/ex/jira/cid/rest/api/3/search/jql')));
  assert.equal(c.browseUrl('A-1'), 'https://x.atlassian.net/browse/A-1');
});
