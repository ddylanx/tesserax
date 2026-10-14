import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BitbucketClient, parseBitbucketRemote } from './bitbucket';

test('parses Bitbucket remotes (ssh and https)', () => {
  assert.deepEqual(parseBitbucketRemote('git@bitbucket.org:acme/multi-tenant-core.git'), { workspace: 'acme', slug: 'multi-tenant-core' });
  assert.deepEqual(parseBitbucketRemote('https://user@bitbucket.org/acme/billing-core.git'), { workspace: 'acme', slug: 'billing-core' });
  assert.equal(parseBitbucketRemote('git@github.com:a/b.git'), null);
});

test('opens a PR, or returns the open one for the branch; never echoes the token', async () => {
  const calls: { method: string; url: string; body?: any }[] = [];
  let open: any[] = [];
  const fake = (async (url: URL, init: RequestInit) => {
    calls.push({ method: init.method ?? 'GET', url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (init.method === 'POST') {
      const pr = { id: 7, state: 'OPEN', links: { html: { href: 'https://bb/pr/7' } } };
      open = [pr];
      return Response.json(pr, { status: 201 });
    }
    return Response.json({ values: open });
  }) as unknown as typeof fetch;
  const c = new BitbucketClient({ baseUrl: 'https://api.bitbucket.org/2.0', email: 'a@b.c', token: 'tok' }, fake);
  const p = { workspace: 'ws', slug: 'repo', title: 'T', description: 'D', source: 'tx/X-1', destination: 'develop' };
  const first = await c.openPullRequest(p);
  assert.deepEqual([first.id, first.existing], [7, false]);
  assert.equal(calls[1]!.body.destination.branch.name, 'develop');
  assert.match(decodeURIComponent(calls[0]!.url), /source\.branch\.name="tx\/X-1"/);
  assert.equal((await c.openPullRequest(p)).existing, true);

  const denied = new BitbucketClient({ baseUrl: 'https://x', email: 'a', token: 'secret-tok' }, (async () => new Response('{"error":{"message":"bad secret-tok"}}', { status: 401 })) as unknown as typeof fetch);
  await assert.rejects(denied.openPullRequest(p), (e: Error) => /401/.test(e.message) && !e.message.includes('secret-tok') && /BITBUCKET_API_TOKEN/.test(e.message));
});
