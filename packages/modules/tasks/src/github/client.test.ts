import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { GithubClient, RateLimitError } from './client';

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = url.toString();
    calls.push({ url: urlStr, init });
    return handler(urlStr, init);
  }) as typeof fetch;
  return { fn, calls };
}

test('listIssues filters out items with pull_request property', async () => {
  const { fn } = mockFetch(() =>
    Response.json([
      { number: 1, title: 'Real issue', pull_request: undefined, labels: [] },
      { number: 2, title: 'Pull request', pull_request: { url: 'https://api.github.com/pr/2' }, labels: [] },
      { number: 3, title: 'Another issue', labels: [] },
    ]),
  );

  const client = new GithubClient({ token: 'test-token', apiUrl: 'https://api.example.com' }, fn);
  const result = await client.listIssues({ repo: 'owner/repo' });

  assert.ok(!('notModified' in result));
  assert.equal(result.issues.length, 2);
  assert.equal(result.issues[0]!.number, 1);
  assert.equal(result.issues[1]!.number, 3);
});

test('listIssues follows Link rel=next pagination', async () => {
  let callCount = 0;
  const { fn, calls } = mockFetch((url: string) => {
    callCount++;
    if (callCount === 1) {
      return new Response(
        JSON.stringify([{ number: 1, title: 'Issue 1', labels: [] }]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            etag: 'W/"etag-page-1"',
            link: '<https://api.example.com/repos/owner/repo/issues?page=2>; rel="next"',
          },
        },
      );
    }
    return new Response(
      JSON.stringify([{ number: 2, title: 'Issue 2', labels: [] }]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });

  const client = new GithubClient({ token: 'test-token', apiUrl: 'https://api.example.com' }, fn);
  const result = await client.listIssues({ repo: 'owner/repo' });

  assert.ok(!('notModified' in result));
  assert.equal(result.issues.length, 2);
  // A page-1 ETag cannot detect changes on later pages, so multi-page listings are never cached.
  assert.equal(result.etag, null);
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.url.includes('page=2'));
});

test('listIssues sends If-None-Match header and returns notModified on 304', async () => {
  const { fn, calls } = mockFetch((_url, init) => {
    const ifNoneMatch = (init?.headers as Record<string, string>)?.['If-None-Match'];
    if (ifNoneMatch === 'etag-123') {
      return new Response(null, { status: 304 });
    }
    return Response.json([]);
  });

  const client = new GithubClient({ token: 'test-token', apiUrl: 'https://api.example.com' }, fn);
  const result = await client.listIssues({ repo: 'owner/repo', etag: 'etag-123' });

  assert.deepEqual(result, { notModified: true });
  assert.equal((calls[0]!.init?.headers as Record<string, string>)['If-None-Match'], 'etag-123');
});

test('listIssues throws clear error on 401 without revealing the token', async () => {
  const secretToken = 'ghp_super_secret_token_12345';
  const { fn } = mockFetch(() =>
    new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
  );

  const client = new GithubClient({ token: secretToken, apiUrl: 'https://api.example.com' }, fn);
  await assert.rejects(
    client.listIssues({ repo: 'owner/repo' }),
    (err: Error) => {
      assert.ok(!err.message.includes(secretToken));
      assert.ok(err.message.includes('401'));
      return true;
    },
  );
});

test('throws RateLimitError on 403 or 429 when x-ratelimit-remaining is 0', async () => {
  const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
  const { fn } = mockFetch(() =>
    new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
      status: 403,
      headers: {
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': String(resetTimestamp),
      },
    }),
  );

  const client = new GithubClient({ token: 'test-token', apiUrl: 'https://api.example.com' }, fn);
  await assert.rejects(
    client.listIssues({ repo: 'owner/repo' }),
    (err: Error) => {
      assert.ok(err instanceof RateLimitError);
      assert.equal(err.name, 'RateLimitError');
      assert.ok(err.message.includes('rate limit exceeded'));
      assert.equal(err.resetAt?.getTime(), resetTimestamp * 1000);
      return true;
    },
  );
});

test('postComment posts comment with bearer token', async () => {
  const { fn, calls } = mockFetch((url, init) => {
    assert.ok(url.endsWith('/repos/owner/repo/issues/42/comments'));
    assert.equal(init?.method, 'POST');
    assert.equal(
      (init?.headers as Record<string, string>)['Authorization'],
      'Bearer my-secret',
    );
    return Response.json({ id: 999 });
  });

  const client = new GithubClient({ token: 'my-secret', apiUrl: 'https://api.example.com' }, fn);
  const result = await client.postComment('owner/repo', 42, 'Hello world');

  assert.deepEqual(result, { id: 999 });
  assert.equal(calls.length, 1);
});

test('listIssues stops at MAX_PAGES (20) and sets truncated=true when next page exists', async () => {
  let requestedPages = 0;
  const { fn } = mockFetch((url: string) => {
    requestedPages++;
    const pageMatch = url.match(/page=(\d+)/);
    const pageNum = pageMatch ? Number(pageMatch[1]) : requestedPages;
    return new Response(
      JSON.stringify([{ number: pageNum, title: `Issue ${pageNum}`, labels: [] }]),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          link: `<https://api.example.com/repos/owner/repo/issues?page=${pageNum + 1}>; rel="next"`,
        },
      },
    );
  });

  const client = new GithubClient({ token: 'test-token', apiUrl: 'https://api.example.com' }, fn);
  const result = await client.listIssues({ repo: 'owner/repo' });

  assert.ok(!('notModified' in result));
  assert.equal(requestedPages, 20);
  assert.equal(result.issues.length, 20);
  assert.equal(result.truncated, true);
  assert.equal(result.etag, null);
});

test('getComments follows Link rel=next pagination', async () => {
  let callCount = 0;
  const { fn } = mockFetch((url: string) => {
    callCount++;
    if (callCount === 1) {
      return new Response(
        JSON.stringify([{ id: 1, user: { login: 'u1' }, created_at: '2026-10-01', body: 'C1' }]),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            link: '<https://api.example.com/repos/owner/repo/issues/42/comments?page=2>; rel="next"',
          },
        },
      );
    }
    return new Response(
      JSON.stringify([{ id: 2, user: { login: 'u2' }, created_at: '2026-10-02', body: 'C2' }]),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  });

  const client = new GithubClient({ token: 'test-token', apiUrl: 'https://api.example.com' }, fn);
  const comments = await client.getComments('owner/repo', 42);

  assert.equal(comments.length, 2);
  assert.equal(comments[0]!.id, 1);
  assert.equal(comments[1]!.id, 2);
  assert.equal(callCount, 2);
});

test('getComments throws clear error on non-ok status', async () => {
  const { fn } = mockFetch(() =>
    new Response(JSON.stringify({ message: 'Internal Server Error' }), { status: 500 }),
  );

  const client = new GithubClient({ token: 'test-token', apiUrl: 'https://api.example.com' }, fn);
  await assert.rejects(
    client.getComments('owner/repo', 42),
    (err: Error) => {
      assert.ok(err.message.includes('500'));
      assert.ok(err.message.includes('Internal Server Error'));
      return true;
    },
  );
});
