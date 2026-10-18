import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AppConfig } from '@tesserax/config';
import { BitbucketPrProvider } from './providers/bitbucket-pr-provider';
import { PrProviderRegistry } from './providers/pr-provider.registry';

const fakeConfig = {
  BITBUCKET_API_URL: 'https://api.bitbucket.org/2.0',
  BITBUCKET_EMAIL: 'user@example.com',
  BITBUCKET_API_TOKEN: 'test-token',
} as unknown as AppConfig;

test('BitbucketPrProvider detects standard SSH and HTTPS Bitbucket remotes', () => {
  const provider = new BitbucketPrProvider(fakeConfig);
  assert.deepEqual(provider.detect('git@bitbucket.org:acme/multi-tenant-core.git'), { owner: 'acme', repo: 'multi-tenant-core' });
  assert.deepEqual(provider.detect('https://user@bitbucket.org/acme/billing-core.git'), { owner: 'acme', repo: 'billing-core' });
  assert.deepEqual(provider.detect('https://bitbucket.org/acme/app.git/'), { owner: 'acme', repo: 'app' });
  assert.deepEqual(provider.detect('acme/direct-repo'), { owner: 'acme', repo: 'direct-repo' });
  assert.equal(provider.detect('git@github.com:acme/repo.git'), null);
  assert.equal(provider.detect('https://github.com/acme/repo'), null);
  assert.equal(provider.detect('not-a-url'), null);
});

test('BitbucketPrProvider parses Bitbucket PR URLs correctly', () => {
  const provider = new BitbucketPrProvider(fakeConfig);
  const parsed = provider.parsePrUrl('https://bitbucket.org/acme/repo/pull-requests/42');
  assert.deepEqual(parsed, {
    owner: 'acme',
    repo: 'repo',
    id: 42,
    url: 'https://bitbucket.org/acme/repo/pull-requests/42',
  });
  assert.equal(provider.parsePrUrl('https://github.com/acme/repo/pull/42'), null);
  assert.equal(provider.parsePrUrl('https://other.com/42'), null);
});

test('BitbucketPrProvider createPr and comment delegate to BitbucketClient', async () => {
  const calls: { method: string; url: string; body?: any }[] = [];
  const fakeFetch = (async (url: URL, init: RequestInit) => {
    calls.push({ method: init.method ?? 'GET', url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (init.method === 'POST') {
      if (String(url).includes('/comments')) {
        return Response.json({ id: 99 });
      }
      return Response.json({ id: 101, state: 'OPEN', links: { html: { href: 'https://bitbucket.org/ws/repo/pull-requests/101' } } }, { status: 201 });
    }
    return Response.json({ values: [] });
  }) as unknown as typeof fetch;

  const provider = new BitbucketPrProvider(fakeConfig, fakeFetch);

  const pr = await provider.createPr({ owner: 'ws', repo: 'repo' }, {
    source: 'tx/FEAT-1',
    target: 'develop',
    title: 'My PR',
    body: 'Description',
  });
  assert.equal(pr.id, 101);
  assert.equal(pr.url, 'https://bitbucket.org/ws/repo/pull-requests/101');
  assert.equal(pr.existing, false);

  const commentResult = await provider.comment({ owner: 'ws', repo: 'repo', id: 101, url: pr.url }, 'LGTM!');
  assert.equal(commentResult.id, 99);
});

test('PrProviderRegistry resolves provider automatically from remote URL', () => {
  const bb = new BitbucketPrProvider(fakeConfig);
  const registry = new PrProviderRegistry([bb]);

  const resolvedSsh = registry.resolve('git@bitbucket.org:org/repo.git');
  assert.ok(resolvedSsh);
  assert.equal(resolvedSsh.provider.kind, 'bitbucket');
  assert.deepEqual(resolvedSsh.repo, { owner: 'org', repo: 'repo' });

  const resolvedHttps = registry.resolve('https://user@bitbucket.org/org/repo.git');
  assert.ok(resolvedHttps);
  assert.equal(resolvedHttps.provider.kind, 'bitbucket');
  assert.deepEqual(resolvedHttps.repo, { owner: 'org', repo: 'repo' });
});

test('PrProviderRegistry honors explicit provider kind and custom git aliases', () => {
  const bb = new BitbucketPrProvider(fakeConfig);
  const registry = new PrProviderRegistry([bb]);

  // Explicit config bitbucket with custom alias
  const resolvedAlias = registry.resolve('git@bb-work:my-team/custom-repo.git', 'bitbucket');
  assert.ok(resolvedAlias);
  assert.equal(resolvedAlias.provider.kind, 'bitbucket');
  assert.deepEqual(resolvedAlias.repo, { owner: 'my-team', repo: 'custom-repo' });

  // Explicit config with workspace/repo slug directly
  const resolvedSlug = registry.resolve('my-team/custom-repo', 'bitbucket');
  assert.ok(resolvedSlug);
  assert.equal(resolvedSlug.provider.kind, 'bitbucket');
  assert.deepEqual(resolvedSlug.repo, { owner: 'my-team', repo: 'custom-repo' });
});

test('PrProviderRegistry gracefully returns null for unsupported providers or URLs', () => {
  const bb = new BitbucketPrProvider(fakeConfig);
  const registry = new PrProviderRegistry([bb]);

  // GitHub URL when no GitHub provider registered
  assert.equal(registry.resolve('git@github.com:org/repo.git'), null);
  assert.equal(registry.resolve('https://github.com/org/repo.git'), null);

  // Explicit kind for unregistered provider
  assert.equal(registry.resolve('git@github.com:org/repo.git', 'github'), null);

  // Unknown remote format
  assert.equal(registry.resolve('invalid-remote'), null);
});

test('PrProviderRegistry.parsePrUrl identifies matching provider and parses PR', () => {
  const bb = new BitbucketPrProvider(fakeConfig);
  const registry = new PrProviderRegistry([bb]);

  const res = registry.parsePrUrl('https://bitbucket.org/my-ws/my-repo/pull-requests/55');
  assert.ok(res);
  assert.equal(res.provider.kind, 'bitbucket');
  assert.deepEqual(res.pr, {
    owner: 'my-ws',
    repo: 'my-repo',
    id: 55,
    url: 'https://bitbucket.org/my-ws/my-repo/pull-requests/55',
  });

  assert.equal(registry.parsePrUrl('https://github.com/org/repo/pull/55'), null);
});
